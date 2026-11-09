# OnQuote

Quoting app for UK tradespeople. Take a few photos of the job, record a short voice note describing the work, and get an itemised quote back in about 10 seconds. You can edit it, then send it by text, email or PDF.

## Features

- 1 to 3 job photos plus a voice note per quote
- Quote generated from your own labour rates, callout fee and parts list
- VAT on or off
- PDF export and sharing, optional calendar entry
- Quote history saved on the device
- Works offline: quotes made without signal are queued and sent when you're back online

## Tech stack

- React Native 0.81, Expo SDK 54 (JavaScript)
- React Navigation
- Expo camera, AV, print, sharing, calendar, haptics
- AsyncStorage for local data
- Anthropic API for generating quotes from photos, OpenAI Whisper for voice transcription (GPT-4o as a fallback)
- Supabase schema and RLS tests for the planned backend (`supabase/`)

## Running it

```bash
npm install
npx expo start
```

Press `a` for Android or `i` for iOS, or scan the QR code with Expo Go. A real phone works best since the app uses the camera and mic.

On first launch open Settings and add your business name, trade, rates and API keys (Anthropic and OpenAI). Keys are stored on the device only, nothing is hardcoded.

### Supabase tests

Copy `.env.example` to `.env`, fill in a test (not production) Supabase project, then:

```bash
node supabase/tests/rls.mjs
```

## Notes

Every quote shows a disclaimer reminding you to check prices and parts before sending. If the photos don't match the voice note, the app asks you to retake them instead of guessing.
