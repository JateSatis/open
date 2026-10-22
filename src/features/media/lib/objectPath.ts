import { extensionFromMime } from './mime';

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
 * Путь во временном бакете `uploads`: запись туда разрешена только в свою
 * папку `{userId}/`. Постоянный путь строит `sanitize-media` сама.
 */
export function buildStagingPath(userId: string, mimeType: string): string {
  return `${userId}/${randomId()}.${extensionFromMime(mimeType)}`;
}

/**
 * Прежняя папка аватаров в публичном бакете `media`. Новые аватары лежат в
 * закрытом бакете `avatars` в папке `{userId}/` — её помнят только для
 * удаления старых файлов.
 */
export const AVATAR_FOLDER = 'avatar';

/** Свой аватар в бакете `avatars` — по пути из профиля; адрес или чужой путь — null. */
export function ownAvatarPath(value: string, userId: string): string | null {
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && value.startsWith(`${userId}/`) ? value : null;
}

/**
 * Аватарки каналов — отдельно от аватара человека: удаление прежнего аватара
 * профиля не должно задевать каналы. Лежат в префиксе владельца (путь строит
 * `sanitize-media`).
 */
export const CHANNEL_AVATAR_FOLDER = 'channel-avatar';

/**
 * Аватарки групп. Лежат в префиксе того, кто поставил фото: другой участник,
 * сменив фото, чужой файл не удалит. `delete-account` эту папку не чистит —
 * фото группы переживает аккаунт.
 */
export const GROUP_AVATAR_FOLDER = 'group-avatar';

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
