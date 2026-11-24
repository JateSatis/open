import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listPopCounters, type Pop } from '@/api/pops';
import { acquirePopTopic } from '@/api/popTopics';
import { applyPopCounters } from '@/features/pops/popsCache';

/** События одной волны — одним запросом: реакции на горячем попе сыплются пачкой. */
const BATCH_MS = 300;

/** Префикс всех списков попсов: сетки каналов, ленты просмотра, выдача поиска. */
const ALL_POPS = ['pops'] as const;

/**
 * Живые счётчики попсов этих каналов: реакции, комментарии и просмотры,
 * пришедшие от других, перечитываются из базы и ложатся во все загруженные
 * списки — сетку, просмотр, выдачу поиска. Топики общие на всё приложение
 * (`popTopics.ts`): канал, который слушают двое, открыт один раз.
 *
 * Каналы — массивом: просмотр выдачи поиска листает попсы многих каналов и
 * слушает каналы активной и соседних страниц. Сменился набор — отпущены те,
 * что ушли, взяты новые; одни и те же каналы не переподписываются.
 */
export function usePopCountersSync(channels: string | readonly string[]) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const list = typeof channels === 'string' ? [channels] : channels;
  // Ключ эффекта — состав, а не массив: новый массив того же состава не
  // должен отпускать топики.
  const key = [...new Set(list)].sort().join(',');

  useEffect(() => {
    if (!key) return undefined;

    const ids = key.split(',');
    const queued = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const flush = () => {
      timer = null;

      const popIds = [...queued];

      queued.clear();
      listPopCounters(popIds, api)
        .then((counters) => {
          if (alive) applyPopCounters(queryClient, counters);
        })
        .catch(() => {
          // Не дочитали — следующее событие или вход на экран принесут свежее.
        });
    };

    const enqueue = (popIds: string[]) => {
      popIds.forEach((id) => queued.add(id));

      if (!timer) timer = setTimeout(flush, BATCH_MS);
    };

    const releases = ids.map((channelId) =>
      acquirePopTopic(channelId, {
        onReactionsChanged: (popId) => enqueue([popId]),
        onCommentsChanged: (popId) => enqueue([popId]),
        onViewsChanged: enqueue,
        // Пропущенное за обрыв — только счётчики загруженных попсов канала.
        // Ленту просмотра не перечитываем: её страницы собраны от выбранного
        // попа, и перечитывание переложило бы их иначе, под пальцем.
        onReconnected: () => {
          const loaded = queryClient
            .getQueriesData<InfiniteData<Pop[], unknown>>({ queryKey: ALL_POPS })
            .flatMap(([, data]) => data?.pages?.flat() ?? [])
            .filter((pop) => pop.channelId === channelId)
            .map((pop) => pop.id);

          enqueue([...new Set(loaded)]);
        },
      }, api),
    );

    return () => {
      alive = false;

      if (timer) clearTimeout(timer);

      releases.forEach((release) => release());
    };
  }, [api, key, queryClient]);
}
