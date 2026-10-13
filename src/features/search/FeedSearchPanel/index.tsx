import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';

import { FeedSearchRowView } from './FeedSearchRowView';
import { POP_GAP, styles } from './styles';

import type { SearchEntity, SearchPop } from '@/api/search';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import {
  buildFeedSearchRows,
  FEED_POP_COLUMNS,
  rowOfPop,
  type FeedSearchRow,
} from '@/features/search/feedSearchRows';
import { useLastSearchPop } from '@/features/search/lastSearchPop';
import { feedRecentQueries } from '@/features/search/recentSearches';
import { COLLAPSED_ROWS } from '@/features/search/searchSections';
import { useFeedSearch } from '@/features/search/useFeedSearch';
import { Spacing } from '@/theme';

export type FeedSearchPanelProps = {
  query: string;
  /** Тап по недавнему запросу — поиск по нему заново. */
  onPickRecent: (query: string) => void;
};

/**
 * Режим поиска «Ленты»: недавние запросы при пустом поле, иначе «Каналы» и
 * «Попсы» сеткой в две колонки. Одна виртуализированная лента: каналы —
 * верхними строками, попсы — рядами по два, догрузка страницами.
 */
export function FeedSearchPanel({ query, onPickRecent }: FeedSearchPanelProps) {
  const router = useRouter();
  const results = useFeedSearch(query);
  const recent = feedRecentQueries.useStore((state) => state.items);
  const currentUserId = useCurrentUserId();
  const { width } = useWindowDimensions();
  const tileWidth =
    (width - Spacing.three * 2 - POP_GAP * (FEED_POP_COLUMNS - 1)) / FEED_POP_COLUMNS;
  const listRef = useRef<FlashListRef<FeedSearchRow>>(null);
  const visibleKeys = useRef(new Set<string>());
  // Раскрытие — свойство запроса: новая буква сворачивает блок обратно.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === query;

  useEffect(() => {
    if (currentUserId) feedRecentQueries.load(currentUserId);
  }, [currentUserId]);

  const rows = useMemo(
    () =>
      buildFeedSearchRows({
        query,
        recent,
        channels: results.channels,
        pops: results.pops,
        channelsExpanded: expanded,
      }),
    [expanded, query, recent, results.channels, results.pops],
  );

  // Новый запрос — новая выдача, с начала: прокрутка прежней спрятала бы каналы.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [query]);

  const remember = useCallback(() => {
    const text = query.trim();

    if (text) feedRecentQueries.add(text);
  }, [query]);

  const openChannel = useCallback(
    (entity: SearchEntity) => {
      remember();
      router.push({ pathname: '/channel/[channelId]', params: { channelId: entity.id } });
    },
    [remember, router],
  );

  const { settledQuery } = results;
  const openPop = useCallback(
    (pop: SearchPop) => {
      remember();
      useLastSearchPop.setState({ id: pop.id });
      router.push({ pathname: '/pops/search', params: { q: settledQuery, start: pop.id } });
    },
    [remember, router, settledQuery],
  );

  const toggleChannels = useCallback(
    () => setExpandedFor(expanded ? null : query),
    [expanded, query],
  );

  // Вернулись из просмотра: последний просмотренный поп ушёл с экрана —
  // сетка встаёт так, чтобы он был виден.
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useFocusEffect(
    useCallback(() => {
      const last = useLastSearchPop.getState().id;

      if (!last) return;

      useLastSearchPop.setState({ id: null });

      const index = rowOfPop(rowsRef.current, last);
      const row = rowsRef.current[index];

      if (index < 0 || !row || visibleKeys.current.has(row.key)) return;

      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    }, []),
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedSearchRow>[] }) => {
      visibleKeys.current = new Set(
        viewableItems.filter((token) => token.isViewable).map((token) => token.item.key),
      );
    },
    [],
  );

  const renderItem = ({ item }: { item: FeedSearchRow }) => (
    <FeedSearchRowView
      row={item}
      parsed={results.parsed}
      tileWidth={tileWidth}
      channelsToggle={
        results.channels.length > COLLAPSED_ROWS
          ? { expanded, onPress: toggleChannels }
          : null
      }
      onClearRecent={feedRecentQueries.clear}
      onPickRecent={onPickRecent}
      onOpenChannel={openChannel}
      onOpenPop={openPop}
    />
  );

  const searching = query.trim() !== '';

  return (
    <FlashList
      ref={listRef}
      testID="feed-search-results"
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.type}
      renderItem={renderItem}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      onEndReached={results.loadMorePops}
      onEndReachedThreshold={0.5}
      onViewableItemsChanged={onViewableItemsChanged}
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
        searching && (results.hasMorePops || (results.isSearching && rows.length === 0)) ? (
          <View style={styles.footer}>
            <ActivityIndicator accessibilityLabel="Ищем" />
          </View>
        ) : null
      }
    />
  );
}
