import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { recheckRecentSearches } from '@/api/search';
import type { RecentSearch } from '@/features/search/recentSearches';

/** Сколько верить перепроверке: настройку поиска меняют редко. */
const RECHECK_STALE_MS = 60_000;

/**
 * «Недавние» лежат на телефоне снимками, и без перепроверки история
 * воскрешала бы человека, который с тех пор закрыл от меня поиск, или время
 * сообщения, которое теперь скрыто. Люди и сообщения показываются только
 * после ответа сервера: кого он не подтвердил — нет, у сообщений — время
 * глазами меня сейчас. Чаты и каналы открываются как есть: их видимость
 * проверяет экран, который откроется.
 */
export function useCheckedRecents(recent: RecentSearch[]): RecentSearch[] {
  const personIds = useMemo(
    () =>
      recent.flatMap((item) =>
        item.type === 'entity' && item.entity.kind === 'person' ? [item.entity.id] : [],
      ),
    [recent],
  );
  const messageIds = useMemo(
    () => recent.flatMap((item) => (item.type === 'message' ? [item.message.id] : [])),
    [recent],
  );
  const { data } = useQuery({
    queryKey: ['search', 'recentRecheck', personIds.join(','), messageIds.join(',')],
    queryFn: () => recheckRecentSearches(personIds, messageIds),
    enabled: personIds.length > 0 || messageIds.length > 0,
    // Новое в «Недавних» не прячет уже проверенное, пока идёт перепроверка.
    placeholderData: (previous) => previous,
    staleTime: RECHECK_STALE_MS,
  });

  return useMemo(
    () =>
      recent.flatMap((item): RecentSearch[] => {
        if (item.type === 'message') {
          if (!data?.messages.has(item.message.id)) return [];

          return [
            {
              type: 'message',
              message: { ...item.message, createdAt: data.messages.get(item.message.id) ?? null },
            },
          ];
        }

        if (item.entity.kind === 'person' && !data?.people.has(item.entity.id)) return [];

        return [item];
      }),
    [data, recent],
  );
}
