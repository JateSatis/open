import { useCallback } from 'react';

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
 * по `seq` с учётом фильтров, переход — окном вокруг записи (`loadAround`).
 * Выдача — под своим ключом с фильтром: смена фильтра пересчитывает её, а
 * правки списка — нет.
 */
export function useSavedSearch(
  query: string | null,
  active: boolean,
  filter: Filter,
  jump: (id: string, seq: number) => Promise<boolean>,
) {
  const { input, key } = filter;

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
      );

      return { items: page.items, nextCursor: page.nextCursor };
    },
    count: (value, signal) => countSavedMessages({ ...input, q: value }, signal),
    jump: useCallback((hit: SavedMessage) => jump(hit.id, hit.seq), [jump]),
  });
}
