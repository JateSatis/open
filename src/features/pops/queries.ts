import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';

import { canPublishInChannel, listPops, POPS_PAGE_SIZE, type Pop } from '@/api/pops';

import { popsQueryKey } from './keys';

export { popsQueryKey };
export const canPublishQueryKey = (channelId: string) =>
  ['channel', channelId, 'can-publish'] as const;

export type PopsPages = InfiniteData<Pop[], Pop | null>;

/** Попсы канала страницами, новые сначала. */
export function usePops(channelId: string) {
  return useInfiniteQuery({
    queryKey: popsQueryKey(channelId),
    queryFn: ({ pageParam }) => listPops(channelId, pageParam),
    initialPageParam: null as Pop | null,
    getNextPageParam: (last) => (last.length < POPS_PAGE_SIZE ? undefined : last[last.length - 1]),
  });
}

/** Могу ли я публиковать в канале. Пока не знаем — не могу: «+» не мигает постороннему. */
export function useCanPublish(channelId: string): boolean {
  return useCanPublishState(channelId).canPublish;
}

/** То же, плюс `known` — ответ уже пришёл, а не «пока нет». */
export function useCanPublishState(channelId: string): { canPublish: boolean; known: boolean } {
  const { data } = useQuery({
    queryKey: canPublishQueryKey(channelId),
    queryFn: () => canPublishInChannel(channelId),
  });

  return { canPublish: data === true, known: data !== undefined };
}
