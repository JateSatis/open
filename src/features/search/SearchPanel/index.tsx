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
import { logSearchQuery, logSearchResultOpened } from '@/features/recs/journal/searchJournal';
import { useOpenSearchResult } from '@/features/search/useOpenSearchResult';
import { useSearch } from '@/features/search/useSearch';
import { Spacing } from '@/theme';

/** Что открыто из выдачи — для журнала: человек, канал или чат. */
function entitySubject(entity: SearchEntity): { type: 'chat' | 'channel' | 'profile'; id: string } {
  if (entity.kind === 'person') return { type: 'profile', id: entity.id };
  if (entity.kind === 'channel' && entity.channelId)
    return { type: 'channel', id: entity.channelId };

  return { type: 'chat', id: entity.chatId ?? entity.id };
}

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

  // Журнал: выдача по запросу пришла.
  const { isSearching } = results;

  useEffect(() => {
    if (!isSearching) {
      logSearchQuery('chats', query, {
        mine: results.mine.length,
        global: results.global.length,
        messages: results.messages.length,
      });
    }
  }, [isSearching, query, results.global.length, results.messages.length, results.mine.length]);

  const openEntity = useCallback(
    (entity: SearchEntity) => open({ type: 'entity', entity }),
    [open],
  );
  const openMessage = useCallback(
    (message: SearchMessage) => open({ type: 'message', message }),
    [open],
  );

  const renderItem = ({
    item,
    index,
    section,
  }: {
    item: SearchRow;
    index: number;
    section: SearchSection;
  }) => {
    // Журнал: что открыли из выдачи и с какого места блока.
    const opened = (
      kind: string,
      subject: { type: 'chat' | 'channel' | 'profile' | 'message'; id: string },
    ) =>
      logSearchResultOpened('chats', subject, {
        kind,
        section: section.key,
        position: index,
        query,
      });
    const pressEntity = (entity: SearchEntity) => {
      opened(entity.kind, entitySubject(entity));
      openEntity(entity);
    };
    const pressMessage = (message: SearchMessage) => {
      opened('message', { type: 'message', id: message.id });
      openMessage(message);
    };

    if (item.type === 'entity') {
      return <SearchEntityRow entity={item.entity} query={results.parsed} onPress={pressEntity} />;
    }
    if (item.type === 'message') {
      return (
        <SearchMessageRow
          message={item.message}
          needle={results.parsed.text}
          onPress={pressMessage}
        />
      );
    }

    return item.item.type === 'entity' ? (
      <SearchEntityRow entity={item.item.entity} query={NO_QUERY} onPress={pressEntity} />
    ) : (
      <SearchMessageRow message={item.item.message} needle="" onPress={pressMessage} />
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
