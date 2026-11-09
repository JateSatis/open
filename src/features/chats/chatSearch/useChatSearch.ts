import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';

import { useMatchSearch, type MatchSearch } from './useMatchSearch';

import {
  countChatSearch,
  searchChatMessages,
  type ChatSearchCursor,
  type ChatSearchHit,
} from '@/api/chats';

/** Параметры адреса, которыми страница чата открывает переписку в поиске. */
export type ChatSearchParams = { search?: string; searchKey?: string };

export type ChatSearch = MatchSearch<ChatSearchHit> & {
  /** Переписка в режиме поиска: поле вместо шапки, плашка вместо поля ввода. */
  active: boolean;
  query: string;
  setQuery: (value: string) => void;
  close: () => void;
};

/**
 * Поиск по одному чату (`useMatchSearch`): открывается и закрывается
 * параметром адреса — его ставит страница чата.
 */
export function useChatSearch(
  chatId: string,
): ChatSearch {
  const params = useLocalSearchParams<ChatSearchParams>();
  const navigation = useNavigation();
  const active = params.search === '1';
  const [query, setQuery] = useState('');

  // Поиск закрыли снаружи (ушли из раздела) — следующий начнётся с пустого поля.
  if (!active && query !== '') setQuery('');

  const search = useMatchSearch<ChatSearchHit, ChatSearchCursor>({
    query,
    active,
    scope: ['chatSearch', chatId],
    fetchPage: (value, cursor, signal) => searchChatMessages(chatId, value, cursor, signal),
    count: (value, signal) => countChatSearch(chatId, value, signal),
  });

  const close = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    navigation.setParams({ search: undefined, searchKey: undefined } as never);
  }, [navigation]);

  return { ...search, active, query, setQuery, close };
}
