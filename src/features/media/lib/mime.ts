const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
};

/** Extension for a storage path. Falls back to `bin` rather than guessing. */
export function extensionFromMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? 'bin';
}

/**
 * Pickers and recorders are inconsistent about reporting a MIME type — the
 * gallery may omit it entirely — so the file extension is the fallback.
 */
export function mimeFromUri(uri: string, fallback: string): string {
  const withoutQuery = uri.split(/[?#]/)[0];
  const extension = withoutQuery.split('.').pop()?.toLowerCase();

  if (!extension) {
    return fallback;
  }

  return MIME_BY_EXTENSION[extension] ?? fallback;
}
