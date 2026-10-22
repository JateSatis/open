import { useEffect, useSyncExternalStore } from 'react';

import {
  avatarEntry,
  avatarRefreshDelay,
  isAvatarPath,
  requestAvatarUrl,
  subscribeAvatarUrls,
} from '@/api/avatars';

/** Что отдать `expo-image`: адрес и ключ кеша. */
export type AvatarSource = { uri: string; cacheKey?: string };

const noSubscription = () => () => {};

/**
 * Аватар человека — путь в закрытом бакете: показывается по подписанной
 * ссылке, а кешируется по пути, чтобы новая подпись не качала файл заново.
 * Адрес (фото группы, канала, от Google, локальный файл) — как есть. Пока
 * ссылки нет или фото скрыто — `null`, и на месте фото заглушка. Ссылку
 * переподписывает до её срока, а после отказа (скрыто, нет сети) — через паузу.
 */
export function useAvatarSource(value: string | null | undefined): AvatarSource | null {
  const path = isAvatarPath(value) ? value : null;
  const entry = useSyncExternalStore(path ? subscribeAvatarUrls : noSubscription, () =>
    path ? avatarEntry(path) : undefined,
  );

  useEffect(() => {
    if (!path) return;

    const delay = avatarRefreshDelay(entry);

    if (delay === 0) {
      requestAvatarUrl(path);
      return;
    }

    const timer = setTimeout(() => requestAvatarUrl(path), delay);

    return () => clearTimeout(timer);
  }, [path, entry]);

  if (!value) return null;
  if (!path) return { uri: value };

  // Ссылку переподписывает таймер выше до её срока — здесь она ещё жива.
  return entry?.url ? { uri: entry.url, cacheKey: path } : null;
}
