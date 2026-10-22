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

/**
 * Прежняя папка аватаров в публичном бакете `media`. Новые аватары лежат в
 * закрытом бакете `avatars` (`buildAvatarPath`) — её помнят только для
 * удаления старых файлов.
 */
export const AVATAR_FOLDER = 'avatar';

/** Путь аватара в закрытом бакете `avatars`: папка — сам пользователь. */
export function buildAvatarPath(userId: string): string {
  return `${userId}/${randomId()}.jpg`;
}

/** Свой аватар в бакете `avatars` — по пути из профиля; адрес или чужой путь — null. */
export function ownAvatarPath(value: string, userId: string): string | null {
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && value.startsWith(`${userId}/`) ? value : null;
}

/**
 * Аватарки каналов — отдельно от аватара человека: удаление прежнего аватара
 * профиля не должно задевать каналы. Лежат в префиксе владельца, потому что
 * запись в бакет разрешена только туда.
 */
export const CHANNEL_AVATAR_FOLDER = 'channel-avatar';

export function buildChannelAvatarPath(userId: string): string {
  return `${userId}/${CHANNEL_AVATAR_FOLDER}/${randomId()}.jpg`;
}

/**
 * Аватарки групп. Лежат в префиксе того, кто поставил фото: запись в бакет
 * разрешена только туда, и другой участник, сменив фото, чужой файл не удалит.
 * `delete-account` эту папку не чистит — фото группы переживает аккаунт.
 */
export const GROUP_AVATAR_FOLDER = 'group-avatar';

export function buildGroupAvatarPath(userId: string): string {
  return `${userId}/${GROUP_AVATAR_FOLDER}/${randomId()}.jpg`;
}

/**
 * Попсы канала — своя папка: у попа своя жизнь (сетка канала, просмотр,
 * удаление попа), и чистить или переносить их удобнее отдельно от вложений
 * переписки. Видео и постер — одно имя, разные расширения.
 */
export const POPS_FOLDER = 'pops';

export function buildPopPaths(userId: string, mimeType: string): { video: string; poster: string } {
  const base = `${userId}/${POPS_FOLDER}/${randomId()}`;

  return { video: `${base}.${extensionFromMime(mimeType)}`, poster: `${base}.jpg` };
}

/**
 * Путь файла в бакете по его публичному URL — только если он лежит в папке
 * `folder` самого `userId`. Внешний адрес (аватар от Google) или чужой файл
 * даёт null: удалять такое приложение не должно.
 */
export function ownPathFromUrl(
  url: string,
  bucket: string,
  userId: string,
  folder: string,
): string | null {
  const marker = `/object/public/${bucket}/`;
  const index = url.indexOf(marker);

  if (index === -1) return null;

  const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);

  return path.startsWith(`${userId}/${folder}/`) ? path : null;
}

/** Путь аватара профиля `userId` по URL; провайдерский или чужой — null. */
export function ownAvatarPathFromUrl(url: string, bucket: string, userId: string): string | null {
  return ownPathFromUrl(url, bucket, userId, AVATAR_FOLDER);
}
