import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { fetchLiveStream, syncStream, type LiveStream } from '@/api/streams';

import { liveStreamQueryKey } from '@/features/streams/streamKeys';

export { liveStreamQueryKey };

/** Звонок, где по базе столько никто не говорит, стоит сверить с LiveKit. */
const QUIET_BEFORE_SYNC_MS = 60_000;

/**
 * Идущий в чате звонок. Числа обновляет событие `stream_changed` канала чата
 * (`useChatChannel`) — здесь только запрос.
 *
 * Если по базе в звонке давно никого нет, просим сервер сверить его с
 * LiveKit: вебхук о выходе мог потеряться, и звонок висел бы «идёт» вечно.
 * Один раз на звонок за время жизни экрана.
 */
export function useLiveStream(chatId: string): LiveStream | null {
  const { data } = useQuery({
    queryKey: liveStreamQueryKey(chatId),
    queryFn: () => fetchLiveStream(chatId),
  });
  const synced = useRef(new Set<string>());

  const stream = data ?? null;

  useEffect(() => {
    if (!stream || stream.speakersCount > 0 || synced.current.has(stream.id)) return;
    if (Date.now() - Date.parse(stream.startedAt) < QUIET_BEFORE_SYNC_MS) return;

    synced.current.add(stream.id);
    syncStream(stream.id).catch(() => undefined);
  }, [stream]);

  return stream;
}
