import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, View } from 'react-native';

import { styles } from './styles';

import type { SearchEntity, SearchMessage } from '@/api/search';
import { useTabBarHeight } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { SearchEntityRow } from '@/features/search/SearchEntityRow';
import { SearchMessageRow } from '@/features/search/SearchMessageRow';
import { SearchSectionHeader } from '@/features/search/SearchSectionHeader';
import {
  clearRecentSearches,
  loadRecentSearches,
  useRecentSearches,
} from '@/features/search/recentSearches';
import { parseSearchQuery } from '@/features/search/searchText';
import {
  buildSearchSections,
  type ExpandableSection,
  type SearchRow,
  type SearchSection,
} from '@/features/search/searchSections';
import { useOpenSearchResult } from '@/features/search/useOpenSearchResult';
import { useSearch } from '@/features/search/useSearch';
import { Spacing } from '@/theme';

/** «Недавние» подсвечивать нечем: запроса нет. */
const NO_QUERY = parseSearchQuery('');

/**
 * Режим поиска «Чатов»: «Недавние» при пустом запросе, иначе блоки выдачи.
 * Одна виртуализированная лента: длинный блок «Сообщения» догружается
 * страницами, прокрутка прячет клавиатуру.
 */
export function SearchPanel({ query }: { query: string }) {
  const results = useSearch(query);
  const recent = useRecentSearches((state) => state.items);
  const open = useOpenSearchResult();
  // Раскрытие — свойство запроса: новая буква сворачивает блоки обратно.
  const [expansion, setExpansion] = useState<{ query: string; open: Set<ExpandableSection> }>({
    query,
    open: new Set(),
  });
  const expanded = useMemo(
    () => (expansion.query === query ? expansion.open : new Set<ExpandableSection>()),
    [expansion, query],
  );

  const currentUserId = useCurrentUserId();
  const tabBarHeight = useTabBarHeight();

  useEffect(() => {
    if (currentUserId) loadRecentSearches(currentUserId);
  }, [currentUserId]);

  const sections = useMemo(
    () =>
      buildSearchSections({
        query,
        recent,
        mine: results.mine,
        global: results.global,
        messages: results.messages,
        expanded,
      }),
    [expanded, query, recent, results.global, results.messages, results.mine],
  );

  const toggle = useCallback(
    (key: ExpandableSection) => {
      const next = new Set(expanded);

      if (next.has(key)) next.delete(key);
      else next.add(key);
      setExpansion({ query, open: next });
    },
    [expanded, query],
  );

  const openEntity = useCallback(
    (entity: SearchEntity) => open({ type: 'entity', entity }),
    [open],
  );
  const openMessage = useCallback(
    (message: SearchMessage) => open({ type: 'message', message }),
    [open],
  );

  const renderItem = ({ item }: { item: SearchRow }) => {
    if (item.type === 'entity') {
      return <SearchEntityRow entity={item.entity} query={results.parsed} onPress={openEntity} />;
    }
    if (item.type === 'message') {
      return (
        <SearchMessageRow
          message={item.message}
          needle={results.parsed.text}
          onPress={openMessage}
        />
      );
    }

    return item.item.type === 'entity' ? (
      <SearchEntityRow entity={item.item.entity} query={NO_QUERY} onPress={openEntity} />
    ) : (
      <SearchMessageRow message={item.item.message} needle="" onPress={openMessage} />
    );
  };

  const renderSectionHeader = ({ section }: { section: SearchSection }) => {
    const key = section.key;
    const action =
      key === 'recent'
        ? { label: 'Очистить', onPress: clearRecentSearches }
        : (key === 'mine' || key === 'global') && section.expandable
          ? { label: section.expanded ? 'Свернуть' : 'Показать ещё', onPress: () => toggle(key) }
          : undefined;

    return <SearchSectionHeader title={section.title} action={action} />;
  };

  const searching = query.trim() !== '';

  return (
    <SectionList
      testID="chats-search-results"
      sections={sections}
      keyExtractor={(row) => row.key}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      // Выдача уходит под панель вкладок, последняя строка докручивается над ней.
      contentContainerStyle={{ paddingBottom: tabBarHeight + Spacing.three }}
      onEndReached={results.loadMoreMessages}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        results.notice ? (
          <Text variant="small" color="textSecondary" style={styles.notice}>
            {results.notice}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        searching && !results.isSearching && !results.notice ? (
          <Text color="textSecondary" style={styles.empty}>
            Ничего не нашлось
          </Text>
        ) : null
      }
      ListFooterComponent={
        searching && (results.hasMoreMessages || (results.isSearching && sections.length === 0)) ? (
          <View style={styles.footer}>
            <ActivityIndicator accessibilityLabel="Ищем" />
          </View>
        ) : null
      }
    />
  );
}
