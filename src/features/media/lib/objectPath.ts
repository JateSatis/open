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

/** Папка аватаров внутри префикса пользователя. Файлы в ней — не часть переписки. */
export const AVATAR_FOLDER = 'avatar';

export function buildAvatarPath(userId: string): string {
  return `${userId}/${AVATAR_FOLDER}/${randomId()}.jpg`;
}

/**
 * Путь файла в бакете по его публичному URL — только если это аватар самого
 * `userId`. Аватар от провайдера (Google) или чужой файл даёт null: удалять
 * такое приложение не должно.
 */
export function ownAvatarPathFromUrl(url: string, bucket: string, userId: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const index = url.indexOf(marker);

  if (index === -1) return null;

  const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);

  return path.startsWith(`${userId}/${AVATAR_FOLDER}/`) ? path : null;
}
