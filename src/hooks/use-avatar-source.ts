import { useEffect, useSyncExternalStore } from 'react';

import {
  isAvatarPath,
  requestAvatarUrl,
  signedAvatarUrl,
  subscribeAvatarUrls,
} from '@/api/avatars';

/** Что отдать `expo-image`: адрес и ключ кеша. */
export type AvatarSource = { uri: string; cacheKey?: string };

const noSubscription = () => () => {};

/**
 * Аватар человека — путь в закрытом бакете: показывается по подписанной
 * ссылке, а кешируется по пути, чтобы новая подпись не качала файл заново.
 * Адрес (фото группы, канала, от Google, локальный файл) — как есть. Пока
 * ссылки нет или фото скрыто — `null`, и на месте фото заглушка.
 */
export function useAvatarSource(value: string | null | undefined): AvatarSource | null {
  const path = isAvatarPath(value) ? value : null;
  const signed = useSyncExternalStore(
    path ? subscribeAvatarUrls : noSubscription,
    () => (path ? signedAvatarUrl(path) : null),
  );

  useEffect(() => {
    if (path && !signed) requestAvatarUrl(path);
  }, [path, signed]);

  if (!value) return null;
  if (!path) return { uri: value };

  return signed ? { uri: signed, cacheKey: path } : null;
}
