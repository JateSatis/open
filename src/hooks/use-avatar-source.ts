import {
  avatarEntry,
  avatarRefreshDelay,
  isAvatarPath,
  requestAvatarUrl,
  subscribeAvatarUrls,
} from '@/api/avatars';
import { useSignedSource, type SignedApi, type SignedSource } from '@/hooks/use-signed-source';

/** Что отдать `expo-image`: адрес и ключ кеша. */
export type AvatarSource = SignedSource;

const avatars: SignedApi = {
  isPath: (value): value is string => isAvatarPath(value),
  entry: (path) => avatarEntry(path),
  refreshDelay: (entry) => avatarRefreshDelay(entry),
  request: (path) => requestAvatarUrl(path),
  subscribe: (listener) => subscribeAvatarUrls(listener),
};

/**
 * Аватар человека — путь в закрытом бакете `avatars`, см. `useSignedSource`.
 * Адрес (фото группы, канала, от Google, локальный файл) — как есть. Пока
 * ссылки нет или фото скрыто — `null`, и на месте фото заглушка.
 */
export function useAvatarSource(value: string | null | undefined): AvatarSource | null {
  return useSignedSource(avatars, value);
}
