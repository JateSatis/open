import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  countSavedMessages,
  listSavedMessages,
  SAVED_PAGE_SIZE,
  type SavedFilterInput,
  type SavedMessage,
} from '@/api/saved';
import { useMatchSearch } from '@/features/chats/chatSearch/useMatchSearch';

type Filter = { input: SavedFilterInput | null; key: string | null };

/**
 * Поиск на «Все» — как в чате (`useMatchSearch`): совпадения новыми вперёд
 * по `seq` с учётом фильтров.
 * Выдача — под своим ключом с фильтром: смена фильтра пересчитывает её, а
 * правки списка — нет.
 */
export function useSavedSearch(
  query: string | null,
  active: boolean,
  filter: Filter,
) {
  const api = useRequestClient();
  const { input, key } = filter;
  const queryClient = useQueryClient();
  const open = query !== null;

  // Выдача живёт, пока открыт поиск: удалённое и исправленное за это время
  // следующий поиск того же слова не покажет по-старому.
  useEffect(() => {
    if (!open) queryClient.removeQueries({ queryKey: ['savedSearch'] });
  }, [open, queryClient]);

  return useMatchSearch<SavedMessage, number>({
    query: query ?? '',
    active: active && query !== null,
    scope: ['savedSearch', key ?? ''],
    fetchPage: async (value, cursor, signal) => {
      const page = await listSavedMessages(
        { before: cursor },
        SAVED_PAGE_SIZE,
        { ...input, q: value },
        signal,
        api,
      );

      return { items: page.items, nextCursor: page.nextCursor };
    },
    count: (value, signal) => countSavedMessages({ ...input, q: value }, signal, api),
  });
}
