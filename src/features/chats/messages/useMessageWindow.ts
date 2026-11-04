import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { listMessagesAfter, listMessagesAround, listMessages, MESSAGE_WINDOW_NEWER_SIZE } from '@/api/chats';
import { MESSAGE_PAGE_SIZE } from '@/api/messagePage';
import {
  mergeMessages,
  messageWindowKey,
  toSent,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import { describeLoadError } from '@/lib/network';

export async function loadMessageWindow(chatId: string, seq: number): Promise<ChatHistory> {
  const { older, newer } = await listMessagesAround(chatId, seq);
  if (!older.items.some((message) => message.seq === seq)) {
    throw new Error('Не удалось найти сообщение');
  }
  return {
    items: [...newer.reverse(), ...older.items].map(toSent),
    nextCursor: older.nextCursor,
    newerCursor: newer.length === MESSAGE_WINDOW_NEWER_SIZE ? newer[0].seq : null,
  };
}

export function useMessageWindow(chatId: string, seq: number | null, tail: ChatHistory | undefined) {
  const queryClient = useQueryClient();
  const [loadingOlderSeq, setLoadingOlderSeq] = useState<number | null>(null);
  const [loadingNewerSeq, setLoadingNewerSeq] = useState<number | null>(null);
  const olderFlight = useRef<{ seq: number; promise: Promise<void> } | null>(null);
  const newerFlight = useRef<{ seq: number; promise: Promise<void> } | null>(null);
  const olderStalled = useRef<number | null>(null);
  const newerStalled = useRef<number | null>(null);
  const [error, setError] = useState<{ seq: number; message: string | null } | null>(null);
  const query = useQuery({
    queryKey: messageWindowKey(chatId, seq ?? 0),
    queryFn: () => loadMessageWindow(chatId, seq ?? 0),
    enabled: seq !== null,
    staleTime: Infinity,
    retry: false,
  });

  // Когда страница догнала живой край, последующие сигналы Realtime видны и здесь.
  useEffect(() => {
    if (seq === null || !tail) return;
    queryClient.setQueryData<ChatHistory>(messageWindowKey(chatId, seq), (window) =>
      window?.newerCursor === null ? mergeMessages(window, tail.items, 'newer') : window,
    );
  }, [chatId, queryClient, seq, tail]);

  const loadOlder = useCallback((): Promise<void> => {
    if (seq === null) return Promise.resolve();
    if (olderFlight.current?.seq === seq) return olderFlight.current.promise;
    const key = messageWindowKey(chatId, seq);
    const cursor = queryClient.getQueryData<ChatHistory>(key)?.nextCursor;
    if (cursor == null || olderStalled.current === seq) return Promise.resolve();
    setLoadingOlderSeq(seq);
    const flight = listMessages(chatId, { cursor })
      .then((page) => {
        queryClient.setQueryData<ChatHistory>(key, (current) => current ? {
          ...mergeMessages(current, page.items, 'older'), nextCursor: page.nextCursor,
        } : current);
        if (olderStalled.current === seq) olderStalled.current = null;
        setError((current) => current?.seq === seq ? null : current);
      })
      .catch((cause: unknown) => {
        olderStalled.current = seq;
        setError({ seq, message: describeLoadError(cause, 'Не удалось загрузить историю') });
      })
      .finally(() => {
        if (olderFlight.current?.promise === flight) olderFlight.current = null;
        setLoadingOlderSeq((current) => current === seq ? null : current);
      });
    olderFlight.current = { seq, promise: flight };
    return flight;
  }, [chatId, queryClient, seq]);

  const loadNewer = useCallback((): Promise<void> => {
    if (seq === null) return Promise.resolve();
    if (newerFlight.current?.seq === seq) return newerFlight.current.promise;
    const key = messageWindowKey(chatId, seq);
    const cursor = queryClient.getQueryData<ChatHistory>(key)?.newerCursor;
    if (cursor == null || newerStalled.current === seq) return Promise.resolve();
    setLoadingNewerSeq(seq);
    const flight = listMessagesAfter(chatId, cursor)
      .then((page) => {
        queryClient.setQueryData<ChatHistory>(key, (current) => {
          if (!current) return current;
          const merged = mergeMessages(current, page, 'newer');
          const atEdge = page.length < MESSAGE_PAGE_SIZE;
          const joined = atEdge && tail ? mergeMessages(merged, tail.items, 'newer') : merged;
          return { ...joined, newerCursor: atEdge ? null : page[page.length - 1].seq };
        });
        if (newerStalled.current === seq) newerStalled.current = null;
        setError((current) => current?.seq === seq ? null : current);
      })
      .catch((cause: unknown) => {
        newerStalled.current = seq;
        setError({ seq, message: describeLoadError(cause, 'Не удалось загрузить историю') });
      })
      .finally(() => {
        if (newerFlight.current?.promise === flight) newerFlight.current = null;
        setLoadingNewerSeq((current) => current === seq ? null : current);
      });
    newerFlight.current = { seq, promise: flight };
    return flight;
  }, [chatId, queryClient, seq, tail]);

  const resumeOlder = useCallback(() => {
    if (olderStalled.current !== seq || seq === null) return;
    olderStalled.current = null;
    void loadOlder();
  }, [loadOlder]);
  const resumeNewer = useCallback(() => {
    if (newerStalled.current !== seq || seq === null) return;
    newerStalled.current = null;
    void loadNewer();
  }, [loadNewer]);

  return {
    history: query.data,
    dataUpdatedAt: query.dataUpdatedAt,
    isLoading: seq !== null && query.isPending,
    failed: seq !== null && query.isError,
    loadingOlder: seq !== null && loadingOlderSeq === seq,
    loadingNewer: seq !== null && loadingNewerSeq === seq,
    error: error?.seq === seq ? error.message : null,
    loadOlder,
    loadNewer,
    resumeOlder,
    resumeNewer,
  };
}
