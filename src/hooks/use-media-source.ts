import { useState } from 'react';

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
  entry: (path) => chatMediaEntry(path),
  refreshDelay: (entry) => chatMediaRefreshDelay(entry),
  request: (path) => requestChatMediaUrl(path),
  subscribe: (listener) => subscribeChatMediaUrls(listener),
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

/**
 * Адрес для плеера видео: первая полученная ссылка держится, пока жив
 * экран. Переподпись дала бы новый адрес, и плеер начал бы ролик заново;
 * ролик до пяти минут дочитывается задолго до конца срока ссылки.
 */
export function useStableMediaUri(value: string | null | undefined): string | null {
  const uri = useMediaUri(value);
  const [held, setHeld] = useState<{ value: typeof value; uri: string } | null>(null);

  if (uri && (!held || held.value !== value)) {
    setHeld({ value, uri });
    return uri;
  }

  return held && held.value === value ? held.uri : uri;
}
