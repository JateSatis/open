import { useEffect, useSyncExternalStore } from 'react';

import type { SignedEntry } from '@/api/signedUrls';

/** Что отдать `expo-image`: адрес и ключ кеша. */
export type SignedSource = { uri: string; cacheKey?: string };

/** Подпись закрытого бакета — то, что отдают `avatars.ts` и `chatMedia.ts`. */
export type SignedApi = {
  isPath: (value: string | null | undefined) => value is string;
  entry: (path: string) => Readonly<SignedEntry> | undefined;
  refreshDelay: (entry: Readonly<SignedEntry> | undefined) => number;
  request: (path: string) => void;
  subscribe: (listener: () => void) => () => void;
};

const noSubscription = () => () => {};

/**
 * Файл закрытого бакета — путь: показывается по подписанной ссылке, а
 * кешируется по пути, чтобы новая подпись не качала файл заново. Адрес
 * (поп, фото от Google, локальный файл) — как есть. Пока ссылки нет или файл
 * скрыт — `null`. Ссылку переподписывает до её срока, а после отказа
 * (скрыто, нет сети) — через паузу.
 */
export function useSignedSource(api: SignedApi, value: string | null | undefined): SignedSource | null {
  const path = api.isPath(value) ? value : null;
  const entry = useSyncExternalStore(path ? api.subscribe : noSubscription, () =>
    path ? api.entry(path) : undefined,
  );

  useEffect(() => {
    if (!path) return;

    const delay = api.refreshDelay(entry);

    if (delay === 0) {
      api.request(path);
      return;
    }

    const timer = setTimeout(() => api.request(path), delay);

    return () => clearTimeout(timer);
  }, [api, path, entry]);

  if (!value) return null;
  if (!path) return { uri: value };

  // Ссылку переподписывает таймер выше до её срока — здесь она ещё жива.
  return entry?.url ? { uri: entry.url, cacheKey: path } : null;
}
