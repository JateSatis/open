import { requestClient } from '@/api/requestClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { localHistory } from '../messages/local/database';
import { stillReader, useHistoryReader } from '../messages/local/reader';
import { loadPage, projection } from '../messages/local/loader';
import { messagesQueryKey } from '../messages/historyCache';
import type { ReadingPlace } from '../messages/local/segments';
import { fetchRead, readKey } from '../messages/local/readQueries';

export function useHistoryOpening(chat: string, active: boolean) {
  const api = useRequestClient();
  const reader = useHistoryReader(),
    client = useQueryClient(),
    connection = useConnectionStatus();
  const [place, setPlace] = useState<ReadingPlace | null | undefined>(() =>
    reader ? (localHistory().place({ reader, chat }) ?? undefined) : null,
  );
  const state = useQuery({
    queryKey: readKey(reader ?? '', chat),
    enabled: !!reader && active,
    queryFn: ({ signal }) => fetchRead(reader!, chat, signal, api),
    refetchOnMount: 'always',
  });
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (place !== undefined || !active || !reader) return;
    const scope = { reader, chat },
      db = localHistory();
    const offline = connection === 'offline';
    if (!offline && (!state.isFetchedAfterMount || state.data === undefined)) return;
    const first =
      state.data?.first ?? (offline ? db.route<ReadingPlace>(reader, 'first/' + chat) : null);
    let live = true;
    const current = () => live && api === requestClient() && stillReader(reader);
    async function prepare() {
      const target = first ?? null;
      if (!offline)
        await loadPage(
          scope,
          target?.messageId
            ? {
                mode: 'around',
                messageId: target.messageId,
                itemId: target.itemId ?? undefined,
                savedSeq: target.seq,
                savedPosition: target.position,
                limit: 30,
              }
            : { mode: 'latest', limit: 20 },
          current,
          api,
        );
      if (!current()) return;
      const cached = projection(scope, db.read(scope, target));
      if (cached) client.setQueryData(messagesQueryKey(chat), cached);
      if (target && cached) db.savePlace(scope, target);
      setPlace(target && cached ? target : null);
    }
    void prepare().catch(() => {
      if (current()) setError(true);
    });
    return () => {
      live = false;
    };
  }, [
    api,
    reader,
    chat,
    place,
    active,
    state.data,
    state.isFetchedAfterMount,
    connection,
    client,
    attempt,
  ]);
  return {
    ready: place !== undefined,
    place,
    eligible:
      state.data !== undefined
        ? !!state.data
        : !!(reader && localHistory().route(reader, 'read-role/' + chat)),
    failed: error || state.isError,
    retry: () => {
      setError(false);
      retry((n) => n + 1);
      void state.refetch();
    },
  };
}
