import { useEffect, useState } from 'react';

import {
  chatMediaEntry,
  chatMediaRefreshDelay,
  isChatMediaPath,
  requestChatMediaUrl,
  subscribeChatMediaUrls,
} from '@/api/chatMedia';
import { useSignedSource, type SignedApi, type SignedSource } from '@/hooks/use-signed-source';

const chatMedia: SignedApi = {
  isPath: (value): value is string => isChatMediaPath(value),
  entry: (path, owner) => chatMediaEntry(path, owner),
  refreshDelay: (entry) => chatMediaRefreshDelay(entry),
  request: (path, owner) => requestChatMediaUrl(path, owner),
  subscribe: (listener, owner) => subscribeChatMediaUrls(listener, owner),
};

/**
 * Картинка вложения для `expo-image`: путь в `chat-media` — по подписанной
 * ссылке с кешем по пути, адрес попа или локальный файл — как есть. `null` —
 * ссылки ещё нет или медиа скрыто.
 */
export function useMediaSource(value: string | null | undefined): SignedSource | null {
  return useSignedSource(chatMedia, value);
}

/** Адрес вложения строкой — для плееров. */
export function useMediaUri(value: string | null | undefined): string | null {
  return useMediaSource(value)?.uri ?? null;
}

/** Держать ссылку плеера не дольше этого: подпись живёт 15 минут. */
const HOLD_MS = 12 * 60_000;

/**
 * Адрес для плеера видео: полученная ссылка держится, пока не подходит её
 * срок. Переподпись даёт новый адрес, и плеер начал бы ролик заново, — поэтому
 * свежая ссылка берётся только когда прежняя вот-вот истечёт (иначе плеер,
 * дочитывая файл после паузы, упёрся бы в мёртвую ссылку).
 */
export function useStableMediaUri(value: string | null | undefined): string | null {
  const uri = useMediaUri(value);
  // Номер срока: раз в HOLD_MS удержанная ссылка разрешает смениться.
  const [epoch, setEpoch] = useState(0);
  const [held, setHeld] = useState<{ value: typeof value; uri: string; epoch: number } | null>(
    null,
  );

  useEffect(() => {
    const timer = setTimeout(() => setEpoch((current) => current + 1), HOLD_MS);

    return () => clearTimeout(timer);
  }, [epoch, value]);

  const fresh = !held || held.value !== value || held.epoch !== epoch;

  if (uri && fresh && uri !== held?.uri) {
    setHeld({ value, uri, epoch });
    return uri;
  }

  return held && held.value === value ? held.uri : uri;
}
