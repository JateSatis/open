// Попсы в кеше: сетка канала (`popsQueryKey`) и ленты просмотра поверх неё
// лежат под общим префиксом `['pops', channelId]`. Поп с тем же id может быть
// в нескольких из них сразу — счётчики меняются везде.

import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { Pop, PopCounters } from '@/api/pops';

/** Префикс всех запросов попсов, всех каналов. */
const ALL_POPS = ['pops'] as const;

export function updatePopEverywhere(
  queryClient: QueryClient,
  popId: string,
  update: (pop: Pop) => Pop,
) {
  queryClient.setQueriesData<InfiniteData<Pop[], unknown>>({ queryKey: ALL_POPS }, (data) => {
    if (!data?.pages) return data;

    let changed = false;
    const pages = data.pages.map((page) => {
      const index = page.findIndex((pop) => pop.id === popId);

      if (index < 0) return page;

      const next = update(page[index]);

      if (next === page[index]) return page;

      changed = true;
      return page.map((pop, i) => (i === index ? next : pop));
    });

    return changed ? { ...data, pages } : data;
  });
}

/** Свежие счётчики из базы — во все загруженные попсы. */
export function applyPopCounters(queryClient: QueryClient, counters: PopCounters[]) {
  for (const fresh of counters) {
    updatePopEverywhere(queryClient, fresh.id, (pop) =>
      pop.viewsCount === fresh.viewsCount &&
      pop.commentsCount === fresh.commentsCount &&
      pop.reactions.mine === fresh.reactions.mine &&
      sameCounts(pop.reactions.counts, fresh.reactions.counts)
        ? pop
        : {
            ...pop,
            reactions: fresh.reactions,
            viewsCount: fresh.viewsCount,
            commentsCount: fresh.commentsCount,
          },
    );
  }
}

/** Свой комментарий к попу в пути — число на кнопке сразу; точное догонит сигнал канала. */
export function bumpPopComments(queryClient: QueryClient, popId: string, delta: number) {
  updatePopEverywhere(queryClient, popId, (pop) => ({
    ...pop,
    commentsCount: Math.max(0, pop.commentsCount + delta),
  }));
}

function sameCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
