import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listPopCounters, type Pop } from '@/api/pops';
import { acquirePopTopic } from '@/api/popTopics';
import { popsQueryKey } from '@/features/pops/keys';
import { applyPopCounters } from '@/features/pops/popsCache';

/** События одной волны — одним запросом: реакции на горячем попе сыплются пачкой. */
const BATCH_MS = 300;

/**
 * Живые счётчики попсов канала: реакции и просмотры, пришедшие от других,
 * перечитываются из базы и ложатся во все загруженные списки — сетку и
 * просмотр. Топик общий на всё приложение (`popTopics.ts`).
 */
export function usePopCountersSync(channelId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const queued = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const flush = () => {
      timer = null;

      const ids = [...queued];

      queued.clear();
      listPopCounters(ids)
        .then((counters) => {
          if (alive) applyPopCounters(queryClient, counters);
        })
        .catch(() => {
          // Не дочитали — следующее событие или вход на экран принесут свежее.
        });
    };

    const enqueue = (ids: string[]) => {
      ids.forEach((id) => queued.add(id));

      if (!timer) timer = setTimeout(flush, BATCH_MS);
    };

    const release = acquirePopTopic(channelId, {
      onReactionsChanged: (popId) => enqueue([popId]),
      onViewsChanged: enqueue,
      // Пропущенное за обрыв — только счётчики загруженных попсов. Ленту
      // просмотра не перечитываем: её страницы собраны от выбранного попа, и
      // перечитывание переложило бы их иначе, под пальцем.
      onReconnected: () => {
        const loaded = queryClient
          .getQueriesData<InfiniteData<Pop[], unknown>>({ queryKey: popsQueryKey(channelId) })
          .flatMap(([, data]) => data?.pages.flat() ?? [])
          .map((pop) => pop.id);

        enqueue([...new Set(loaded)]);
      },
    });

    return () => {
      alive = false;

      if (timer) clearTimeout(timer);

      release();
    };
  }, [channelId, queryClient]);
}
