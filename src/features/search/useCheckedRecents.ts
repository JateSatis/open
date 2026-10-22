import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { recheckRecentSearches } from '@/api/search';
import type { RecentSearch } from '@/features/search/recentSearches';

/** Сколько верить перепроверке: настройку поиска меняют редко. */
const RECHECK_STALE_MS = 60_000;

/**
 * «Недавние» лежат на телефоне снимками, и без перепроверки история
 * воскрешала бы человека, который с тех пор закрыл от меня поиск, его
 * настоящее имя, которое он с тех пор скрыл, или время сообщения, которое
 * теперь скрыто. Люди и сообщения показываются только после ответа сервера:
 * кого он не подтвердил — нет, остальные — с именем и временем глазами меня
 * сейчас. Чаты и каналы открываются как есть: их видимость
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
          const fresh = data?.messages.get(item.message.id);

          if (!fresh) return [];

          return [
            {
              type: 'message',
              message: { ...item.message, createdAt: fresh.createdAt, authorName: fresh.authorName },
            },
          ];
        }

        if (item.entity.kind !== 'person') return [item];

        // Человек — каким он виден мне сейчас, а не каким был в момент тапа.
        const person = data?.people.get(item.entity.id);

        return person ? [{ type: 'entity', entity: { ...item.entity, ...person } }] : [];
      }),
    [data, recent],
  );
}
