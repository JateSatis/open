// Лента просмотра попсов: попсы канала в порядке сетки, от выбранного в обе
// стороны. Выше (раньше в ленте) — новее, ниже — старше.

import { requestClient } from '@/api/requestClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { getPop, listPops, listPopsAfter, type Pop } from '@/api/pops';
import { popsQueryKey, type PopsPages } from '@/features/pops/queries';

/**
 * Откуда страница: стартовая — выбранный поп с соседями, дальше — старше
 * последнего загруженного или новее первого.
 */
export type PopFeedParam =
  | { kind: 'start' }
  | { kind: 'older'; after: Pick<Pop, 'id' | 'createdAt'> }
  | { kind: 'newer'; before: Pick<Pop, 'id' | 'createdAt'> };

export const popFeedQueryKey = (channelId: string, startId: string) =>
  [...popsQueryKey(channelId), 'feed', startId] as const;

/** Сетка уже загрузила выбранный поп — лента начинается с неё, без ожидания сети. */
function fromGrid(queryClient: QueryClient, channelId: string, startId: string): Pop[] | null {
  const grid = queryClient.getQueryData<PopsPages>(popsQueryKey(channelId))?.pages.flat() ?? [];

  return grid.some((pop) => pop.id === startId) ? grid : null;
}

async function loadStart(channelId: string, startId: string, api = requestClient()): Promise<Pop[]> {
  const start = await getPop(startId, api);

  if (!start) return [];

  const [newer, older] = await Promise.all([
    listPopsAfter(channelId, start, undefined, api),
    listPops(channelId, start, undefined, api),
  ]);

  return [...newer, start, ...older];
}

export function usePopFeed(channelId: string, startId: string) {
  const api = useRequestClient();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: popFeedQueryKey(channelId, startId),
    queryFn: ({ pageParam }): Promise<Pop[]> => {
      if (pageParam.kind === 'older') return listPops(channelId, pageParam.after, undefined, api);
      if (pageParam.kind === 'newer') return listPopsAfter(channelId, pageParam.before, undefined, api);

      const grid = fromGrid(queryClient, channelId, startId);

      return grid ? Promise.resolve(grid) : loadStart(channelId, startId, api);
    },
    initialPageParam: { kind: 'start' } as PopFeedParam,
    initialData: (): InfiniteData<Pop[], PopFeedParam> | undefined => {
      const grid = fromGrid(queryClient, channelId, startId);

      return grid ? { pages: [grid], pageParams: [{ kind: 'start' }] } : undefined;
    },
    // Пустая страница — край: дальше в эту сторону попсов нет.
    getNextPageParam: (last) =>
      last.length === 0 ? undefined : { kind: 'older' as const, after: last[last.length - 1] },
    getPreviousPageParam: (first) =>
      first.length === 0 ? undefined : { kind: 'newer' as const, before: first[0] },
    // Счётчики живут событиями топика; перечитывать всю ленту на каждый вход незачем.
    staleTime: Infinity,
  });

  const pops = useMemo(() => {
    const seen = new Set<string>();

    // Страницы соседей могут перекрыться с сеткой — один поп показывается раз.
    return (query.data?.pages.flat() ?? []).filter((pop) => {
      if (seen.has(pop.id)) return false;

      seen.add(pop.id);
      return true;
    });
  }, [query.data]);

  return { ...query, pops };
}
