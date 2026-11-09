import * as Network from 'expo-network';
import { getSettings } from './storage';
import { getPricingForCurrentTrade } from './pricing';
import { compressPhoto, fileToBase64 } from '../utils/fileHelpers';

const TIMEOUT_MS = 30_000;

// Helpers

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout - check signal and try again.')), ms)
    ),
  ]);
}

function extractJson(text) {
  if (!text) throw new Error('Empty AI response.');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI response was not JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

function shortenApiError(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    return (j.error?.message || j.message || '').slice(0, 140);
  } catch {
    return text.slice(0, 140);
  }
}

/** Check if we're online right now. Returns boolean; never throws. */
export async function isOnline() {
  try {
    const state = await Network.getNetworkStateAsync();
    return !!(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true; // optimistic - let the request try
  }
}

// Transcription (Whisper)

export async function transcribeVoice(voiceUri) {
  const { openaiKey } = await getSettings();
  if (!openaiKey) {
    throw new Error('Add your OpenAI API key in Settings to enable transcription.');
  }

  const form = new FormData();
  form.append('file', { uri: voiceUri, name: 'voice.m4a', type: 'audio/m4a' });
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const res = await withTimeout(
    fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    })
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Transcription failed (${res.status}). ${shortenApiError(errText)}`);
  }
  const json = await res.json();
  const text = (json.text || '').trim();
  if (!text) throw new Error('Could not make out the voice note - try again in a quieter spot.');
  return text;
}

// Prompt assembly

function buildPrompt({ trade, transcript, pricing, businessName, vatRegistered, photoCount }) {
  return `You are OnQuote, a practical UK trade estimator helping a ${trade} on a job site.
The tradesperson just took ${photoCount} photo(s) and left this voice note:

"${transcript}"

Using the photos AND voice note, produce a professional customer-ready quote.

THEIR RATES (use these exact figures - do not invent prices):
${JSON.stringify(pricing, null, 2)}

BUSINESS:
- Name: ${businessName || '(not set)'}
- VAT registered: ${vatRegistered ? 'yes' : 'no'}

OUTPUT - return ONLY valid JSON, no markdown, matching this shape:
{
  "customer_summary": "One short sentence a customer understands.",
  "diagnosis": "2-3 sentences - what you see in the photos and hear in the note.",
  "line_items": [
    { "description": "...", "qty": 1, "unit": "each|hour|m", "unit_price": 0.00, "total": 0.00 }
  ],
  "labour_hours": 0.0,
  "subtotal": 0.00,
  "vat": 0.00,
  "total": 0.00,
  "estimated_duration": "e.g. 1-2 hours, same day",
  "upsells": [
    { "title": "...", "why": "One-line benefit to customer", "price": 0.00 }
  ],
  "notes_for_tradesperson": "Anything odd in the photos worth checking on arrival."
}

RULES:
- Max 2 upsells, only if genuinely useful.
- If photos are too blurry or don't match the voice note, set "diagnosis" to start with "UNCLEAR:" and explain what's needed.
- All prices in GBP. Round to nearest £1 except sub-£10 parts.
- Include the callout fee as the first line item.
- VAT line = subtotal * vat_rate (use 0 if not VAT registered).
- Be practical. Helpful mate tone, not corporate.`;
}

// Claude Vision (primary)

async function generateWithClaude({ anthropicKey, prompt, photoBase64s }) {
  const content = [
    ...photoBase64s.map((b64) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    })),
    { type: 'text', text: prompt },
  ];

  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content }],
      }),
    })
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude error (${res.status}). ${shortenApiError(errText)}`);
  }
  const json = await res.json();
  const text = json?.content?.find?.((b) => b.type === 'text')?.text || '';
  return extractJson(text);
}

// GPT-4o Vision (fallback)

async function generateWithOpenAI({ openaiKey, prompt, photoBase64s }) {
  const content = [
    { type: 'text', text: prompt },
    ...photoBase64s.map((b64) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    })),
  ];

  const res = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1500,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
      }),
    })
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GPT-4o error (${res.status}). ${shortenApiError(errText)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';
  return extractJson(text);
}

// Public: full pipeline

/**
 * Full pipeline: compress photos → transcribe voice → call AI → return quote JSON.
 *
 * @param {{
 *   photoUris: string[],
 *   voiceUri: string,
 *   onStage?: (s: { stage: string, note: string }) => void
 * }} args
 */
export async function generateQuote({ photoUris, voiceUri, onStage }) {
  const settings = await getSettings();
  const { anthropicKey, openaiKey, businessName, vatRegistered } = settings;

  if (!anthropicKey && !openaiKey) {
    throw new Error('Add an Anthropic or OpenAI API key in Settings first.');
  }

  // 0. Offline check - fail fast with a clear message
  if (!(await isOnline())) {
    const err = new Error('You\'re offline - the quote will send itself when you\'re back on signal.');
    err.code = 'OFFLINE';
    throw err;
  }

  // 1. Transcribe voice
  onStage?.({ stage: 'transcribe', note: 'Listening to your voice note…' });
  const transcript = await transcribeVoice(voiceUri);

  // 2. Compress + encode photos (big win for upload speed + token cost)
  onStage?.({ stage: 'prep', note: 'Reading your photos…' });
  const compressed = await Promise.all(photoUris.map(compressPhoto));
  const photoBase64s = await Promise.all(compressed.map(fileToBase64));
  const pricing = await getPricingForCurrentTrade();

  // 3. Build prompt
  const prompt = buildPrompt({
    trade: pricing.trade,
    transcript,
    pricing,
    businessName,
    vatRegistered,
    photoCount: photoUris.length,
  });

  // 4. Call primary, fall back on failure
  onStage?.({ stage: 'generate', note: 'Writing the quote…' });
  let ai;
  let usedModel = null;
  let primaryErr = null;

  if (anthropicKey) {
    try {
      ai = await generateWithClaude({ anthropicKey, prompt, photoBase64s });
      usedModel = 'claude-sonnet-4-5';
    } catch (e) {
      primaryErr = e;
      console.warn('Claude call failed, trying fallback:', e.message);
    }
  }
  if (!ai && openaiKey) {
    ai = await generateWithOpenAI({ openaiKey, prompt, photoBase64s });
    usedModel = 'gpt-4o';
  }
  if (!ai) throw primaryErr || new Error('AI call failed.');

  // 5. Validate
  if (!ai.line_items || !Array.isArray(ai.line_items)) {
    throw new Error('AI response was missing line items - try again.');
  }
  if (typeof ai.diagnosis === 'string' && ai.diagnosis.startsWith('UNCLEAR:')) {
    const reason = ai.diagnosis.replace(/^UNCLEAR:\s*/, '');
    const err = new Error(reason || 'Photos or voice note unclear - please retake.');
    err.code = 'UNCLEAR';
    throw err;
  }

  return { transcript, ai, usedModel, compressedPhotos: compressed };
}
