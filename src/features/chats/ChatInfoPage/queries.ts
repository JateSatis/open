import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
  getChatInfoSummary,
  getLastSeen,
  listChatMedia,
  listChatVoices,
  listCommonGroups,
  type InfoCursor,
} from '@/api/chatInfo';
import type { InfoStatus } from '@/components/InfoPage';
import { formatLastSeen } from '@/lib/dates';

// Ключи — под ключом чата: перечитывание чата после событий (`chatQueryKey`
// без `exact`) перечитывает и страницу.
export const chatInfoKeys = {
  summary: (chatId: string) => ['chat', chatId, 'info', 'summary'] as const,
  media: (chatId: string) => ['chat', chatId, 'info', 'media'] as const,
  voices: (chatId: string) => ['chat', chatId, 'info', 'voices'] as const,
  commonGroups: (userId: string) => ['commonGroups', userId] as const,
  lastSeen: (userIds: string[]) => ['lastSeen', userIds.join(',')] as const,
};

/** Сколько подождать отметку ушедшего из сети, прежде чем её перечитать. */
const LAST_SEEN_SETTLE_MS = 2500;

export function useChatInfoSummary(chatId: string) {
  return useQuery({
    queryKey: chatInfoKeys.summary(chatId),
    queryFn: () => getChatInfoSummary(chatId),
  });
}

export function useChatMedia(chatId: string) {
  return useInfiniteQuery({
    queryKey: chatInfoKeys.media(chatId),
    queryFn: ({ pageParam }) => listChatMedia(chatId, pageParam),
    initialPageParam: null as InfoCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export function useChatVoices(chatId: string) {
  return useInfiniteQuery({
    queryKey: chatInfoKeys.voices(chatId),
    queryFn: ({ pageParam }) => listChatVoices(chatId, pageParam),
    initialPageParam: null as InfoCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export function useCommonGroups(userId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: chatInfoKeys.commonGroups(userId ?? ''),
    queryFn: ({ pageParam }) => listCommonGroups(userId as string, pageParam),
    initialPageParam: null as InfoCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: enabled && Boolean(userId),
  });
}

/**
 * Статус людей: «в сети» из Presence, иначе «был(а) …» из профиля. Кто
 * только что ушёл из сети — его отметка перечитывается: приложение отметило
 * её, уходя в фон.
 */
export function usePeopleStatus(
  userIds: string[],
  online: Set<string>,
): Map<string, InfoStatus | null> {
  const queryClient = useQueryClient();
  const ids = useMemo(() => [...userIds].sort(), [userIds]);
  const key = chatInfoKeys.lastSeen(ids);
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => getLastSeen(ids),
    enabled: ids.length > 0,
  });
  const wasOnline = useRef(new Set<string>());

  useEffect(() => {
    const left = [...wasOnline.current].some((id) => !online.has(id) && ids.includes(id));

    wasOnline.current = new Set(ids.filter((id) => online.has(id)));
    if (!left) return;

    // Ушедший отмечается сам, отдельным запросом, — дать ему дойти.
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: chatInfoKeys.lastSeen(ids) }),
      LAST_SEEN_SETTLE_MS,
    );

    return () => clearTimeout(timer);
  }, [ids, online, queryClient]);

  return useMemo(() => {
    const statuses = new Map<string, InfoStatus | null>();

    for (const id of ids) {
      if (online.has(id)) statuses.set(id, { text: 'в сети', accent: true });
      // Пока отметка не пришла — пусто, а не «был(а) давно».
      else if (data) statuses.set(id, { text: formatLastSeen(data.get(id) ?? null) });
      else statuses.set(id, null);
    }

    return statuses;
  }, [data, ids, online]);
}
