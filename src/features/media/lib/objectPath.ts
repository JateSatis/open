import { extensionFromMime } from './mime';

import type { MediaKind } from '@/features/media/types';

/**
 * Not a security token — it only has to avoid collisions inside one user's
 * prefix. Using `expo-crypto` for this would add a native dependency to
 * generate a filename.
 */
function randomId(): string {
  const random = Math.random().toString(36).slice(2, 10);

  return `${Date.now().toString(36)}-${random}`;
}

/**
 * The leading `{userId}/` is what the Storage policy matches on: reads are
 * public because the content is, writes are confined to the owner's prefix.
 */
export function buildObjectPath(userId: string, kind: MediaKind, mimeType: string): string {
  return `${userId}/${kind}/${randomId()}.${extensionFromMime(mimeType)}`;
}
