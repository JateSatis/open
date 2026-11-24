import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';

import { canPublishInChannel, listPops, POPS_PAGE_SIZE, type Pop } from '@/api/pops';

import { popsQueryKey } from './keys';
import { useHistoryReader } from '@/features/chats/messages/local/reader';
import { routeOptions } from '@/features/chats/messages/local/route';

export { popsQueryKey };
export const canPublishQueryKey = (channelId: string) =>
  ['channel', channelId, 'can-publish'] as const;

export type PopsPages = InfiniteData<Pop[], Pop | null>;

/** Попсы канала страницами, новые сначала. */
export function usePops(channelId: string) {
  const api = useRequestClient();
  return useInfiniteQuery({
    queryKey: popsQueryKey(channelId),
    queryFn: ({ pageParam }) => listPops(channelId, pageParam, undefined, api),
    initialPageParam: null as Pop | null,
    getNextPageParam: (last) => (last.length < POPS_PAGE_SIZE ? undefined : last[last.length - 1]),
  });
}

/** Могу ли я публиковать в канале. Пока не знаем — не могу: «+» не мигает постороннему. */
export function useCanPublish(channelId: string): boolean {
  return useCanPublishState(channelId).canPublish;
}

/**
 * То же, плюс `known` — ответ уже пришёл, а не «пока нет». Канал ещё не
 * известен (`null`) — не спрашиваем.
 */
export function useCanPublishState(channelId: string | null): {
  canPublish: boolean;
  known: boolean;
  /** Спросить не удалось — ответа не будет до следующей попытки. */
  failed: boolean;
} {
  const api = useRequestClient();
  const reader = useHistoryReader();
  const { data, isError } = useQuery({
    queryKey: canPublishQueryKey(channelId ?? ''),
    ...routeOptions(reader, 'publish/' + channelId, () => canPublishInChannel(channelId!, api)),
    enabled: channelId !== null,
  });

  return { canPublish: data === true, known: data !== undefined, failed: isError };
}
