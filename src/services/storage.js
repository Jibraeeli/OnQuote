import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  QUOTES: 'onquote.quotes.v1',
  SETTINGS: 'onquote.settings.v1',
};

// Quotes

export async function getQuotes() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.QUOTES);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('getQuotes failed', e);
    return [];
  }
}

export async function saveQuote(quote) {
  const list = await getQuotes();
  const existingIdx = list.findIndex((q) => q.id === quote.id);
  if (existingIdx >= 0) list[existingIdx] = quote;
  else list.unshift(quote);
  await AsyncStorage.setItem(KEYS.QUOTES, JSON.stringify(list));
  return quote;
}

export async function deleteQuote(id) {
  const list = await getQuotes();
  const filtered = list.filter((q) => q.id !== id);
  await AsyncStorage.setItem(KEYS.QUOTES, JSON.stringify(filtered));
}

// Settings

const DEFAULT_SETTINGS = {
  businessName: '',
  trade: 'plumber',
  labourHourly: 65,
  calloutFee: 45,
  vatRegistered: true,
  vatRate: 0.20,
  anthropicKey: '',
  openaiKey: '',
};

export async function getSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(next));
  return next;
}
