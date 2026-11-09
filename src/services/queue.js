import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { generateQuote } from './ai';
import { saveQuote } from './storage';

const KEY = 'onquote.queue.v1';

// Storage

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeQueue(list) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

// Public API

/**
 * Add a pending job. Used when generateQuote throws OFFLINE.
 * @param {{ photoUris: string[], voiceUri: string, voiceDuration: number }} job
 */
export async function enqueueJob(job) {
  const list = await readQueue();
  const entry = {
    id: `job_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...job,
    attempts: 0,
    lastError: null,
  };
  list.push(entry);
  await writeQueue(list);
  return entry;
}

export async function getPendingJobs() {
  return readQueue();
}

export async function getPendingCount() {
  return (await readQueue()).length;
}

export async function removeJob(id) {
  const list = await readQueue();
  await writeQueue(list.filter((j) => j.id !== id));
}

export async function clearQueue() {
  await writeQueue([]);
}

/**
 * Try to process every queued job. Returns a summary.
 * Silently tolerates mid-flight failures - failing jobs stay queued.
 */
export async function processQueue() {
  const state = await Network.getNetworkStateAsync().catch(() => ({ isConnected: false }));
  if (!state.isConnected) return { processed: 0, failed: 0, remaining: await getPendingCount() };

  const list = await readQueue();
  if (list.length === 0) return { processed: 0, failed: 0, remaining: 0 };

  let processed = 0;
  let failed = 0;
  const remaining = [];

  for (const job of list) {
    try {
      const { transcript, ai, usedModel, compressedPhotos } = await generateQuote({
        photoUris: job.photoUris,
        voiceUri: job.voiceUri,
      });
      await saveQuote({
        id: `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        createdAt: new Date().toISOString(),
        customer: { name: '', phone: '', email: '' },
        photos: compressedPhotos || job.photoUris,
        voiceUri: job.voiceUri,
        voiceDuration: job.voiceDuration,
        transcript,
        ai,
        edits: {},
        status: 'draft',
        usedModel,
        fromQueue: true,
      });
      processed++;
    } catch (e) {
      failed++;
      remaining.push({
        ...job,
        attempts: (job.attempts || 0) + 1,
        lastError: e.message || 'Unknown error',
      });
    }
  }

  await writeQueue(remaining);
  return { processed, failed, remaining: remaining.length };
}
