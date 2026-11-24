import type { AccountClient } from '@/api/accountClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { SignedEntry } from '@/api/signedUrls';

/** Что отдать `expo-image`: адрес и ключ кеша. */
export type SignedSource = { uri: string; cacheKey?: string };

/** Подпись закрытого бакета — то, что отдают `avatars.ts` и `chatMedia.ts`. */
export type SignedApi = {
  isPath: (value: string | null | undefined) => value is string;
  entry: (path: string, owner: AccountClient) => Readonly<SignedEntry> | undefined;
  refreshDelay: (entry: Readonly<SignedEntry> | undefined) => number;
  request: (path: string, owner: AccountClient) => void;
  subscribe: (listener: () => void, owner: AccountClient) => () => void;
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
  const owner = useRequestClient();
  const subscribe = useCallback((listener: () => void) => api.subscribe(listener, owner), [api, owner]);
  const path = api.isPath(value) ? value : null;
  const entry = useSyncExternalStore(path ? subscribe : noSubscription, () =>
    path ? api.entry(path, owner) : undefined,
  );

  useEffect(() => {
    if (!path) return;

    const delay = api.refreshDelay(entry);

    if (delay === 0) {
      api.request(path, owner);
      return;
    }

    const timer = setTimeout(() => api.request(path, owner), delay);

    return () => clearTimeout(timer);
  }, [api, path, entry, owner]);

  if (!value) return null;
  if (!path) return { uri: value };

  // Ссылку переподписывает таймер выше до её срока — здесь она ещё жива.
  return entry?.url ? { uri: entry.url, cacheKey: path } : null;
}
