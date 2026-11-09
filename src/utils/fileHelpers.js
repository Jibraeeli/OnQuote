import * as ImageManipulator from 'expo-image-manipulator';
// SDK 54 moved the classic file API to the /legacy subpath. The top-level
// 'expo-file-system' now exports the new class-based API (File/Directory/Paths)
// where readAsStringAsync, getInfoAsync and EncodingType no longer exist -
// accessing them throws "Cannot read property 'Base64' of undefined".
import * as FileSystem from 'expo-file-system/legacy';

const MAX_EDGE = 1280;     // Longest side in pixels after resize
const JPEG_QUALITY = 0.6;  // ~60% - good enough for AI vision, far smaller files

/**
 * Compress and resize a photo for AI upload. Returns a new file URI.
 * Typical result: 2-4MB iPhone photo → ~150-400KB JPEG.
 */
export async function compressPhoto(uri) {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_EDGE } }], // keeps aspect ratio
      { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch (e) {
    console.warn('compressPhoto failed, falling back to original', e);
    return uri;
  }
}

export async function getFileSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.size || 0;
  } catch {
    return 0;
  }
}

export async function fileToBase64(uri) {
  // SDK 54: EncodingType lives on the legacy export. Pass the string literal
  // to avoid the whole 'undefined' problem.
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}
