import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { getChannelInfoSummary } from '@/api/channels';
import { listChannelSubscribers, SUBSCRIBERS_PAGE_SIZE, type Subscriber } from '@/api/subscriptions';
import { channelQueryKey } from '@/features/channels/keys';

// Ключи — под ключом канала: перечитывание канала (`channelQueryKey` без
// `exact`) перечитывает и страницу.
export const channelInfoKeys = {
  summary: (channelId: string) => [...channelQueryKey(channelId), 'info', 'summary'] as const,
  subscribers: (channelId: string, query: string) =>
    [...channelQueryKey(channelId), 'info', 'subscribers', query] as const,
};

export function useChannelInfoSummary(channelId: string) {
  const api = useRequestClient();
  return useQuery({
    queryKey: channelInfoKeys.summary(channelId),
    queryFn: () => getChannelInfoSummary(channelId, api),
  });
}

/**
 * Подписчики канала страницами, свежие сверху. `query` — поиск на сервере
 * по имени и `@имени`: пустой — все. Видит только владелец.
 */
export function useChannelSubscribers(channelId: string, query: string, enabled: boolean) {
  const api = useRequestClient();
  return useInfiniteQuery({
    queryKey: channelInfoKeys.subscribers(channelId, query),
    queryFn: ({ pageParam }) => listChannelSubscribers(channelId, pageParam, query, api),
    initialPageParam: null as Subscriber | null,
    getNextPageParam: (last) =>
      last.length < SUBSCRIBERS_PAGE_SIZE ? undefined : last[last.length - 1],
    enabled,
  });
}
