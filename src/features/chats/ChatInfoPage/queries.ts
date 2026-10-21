import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  getChatInfoSummary,
  listChatMedia,
  listChatVoices,
  listCommonGroups,
  type InfoCursor,
  type MessageCursor,
} from '@/api/chatInfo';
import type { InfoStatus } from '@/components/InfoPage';
import { usePeopleActivity } from '@/features/chats/useOnlineUsers';
import { formatLastSeen } from '@/lib/dates';

// Ключи — под ключом чата: перечитывание чата после событий (`chatQueryKey`
// без `exact`) перечитывает и страницу.
export const chatInfoKeys = {
  summary: (chatId: string) => ['chat', chatId, 'info', 'summary'] as const,
  media: (chatId: string) => ['chat', chatId, 'info', 'media'] as const,
  voices: (chatId: string) => ['chat', chatId, 'info', 'voices'] as const,
  commonGroups: (userId: string) => ['commonGroups', userId] as const,
};

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
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export function useChatVoices(chatId: string) {
  return useInfiniteQuery({
    queryKey: chatInfoKeys.voices(chatId),
    queryFn: ({ pageParam }) => listChatVoices(chatId, pageParam),
    initialPageParam: null as MessageCursor | null,
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
 * Статус людей с сервера: «в сети», иначе «был(а) …». Кому настройка не
 * разрешает — «был(а) давно», как у ни разу не заходившего: скрытое не
 * отличить от неизвестного.
 */
export function usePeopleStatus(userIds: string[]): Map<string, InfoStatus | null> {
  const activity = usePeopleActivity(userIds);

  return useMemo(() => {
    const statuses = new Map<string, InfoStatus | null>();

    for (const id of userIds) {
      const status = activity?.get(id);

      if (status?.online) statuses.set(id, { text: 'в сети', accent: true });
      // Пока ответа нет — пусто, а не «был(а) давно».
      else if (activity) statuses.set(id, { text: formatLastSeen(status?.lastSeenAt ?? null) });
      else statuses.set(id, null);
    }

    return statuses;
  }, [activity, userIds]);
}
