import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';

import { FeedSearchRowView } from './FeedSearchRowView';
import { POP_GAP, styles } from './styles';
import { useRestoreLastSearchPop } from './useRestoreLastSearchPop';

import type { SearchEntity, SearchPop } from '@/api/search';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import {
  buildFeedSearchRows,
  FEED_POP_COLUMNS,
  type FeedSearchRow,
} from '@/features/search/feedSearchRows';
import { useLastSearchPop } from '@/features/search/lastSearchPop';
import { feedRecentQueries } from '@/features/search/recentSearches';
import { COLLAPSED_ROWS } from '@/features/search/searchSections';
import { useFeedSearch } from '@/features/search/useFeedSearch';
import { Spacing } from '@/theme';

const NO_POSITION_HOLD = { disabled: true } as const;

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

  const { shownQuery } = results;
  const openPop = useCallback(
    (pop: SearchPop) => {
      remember();
      useLastSearchPop.setState({ id: pop.id });
      router.push({ pathname: '/pops/search', params: { q: shownQuery, start: pop.id } });
    },
    [remember, router, shownQuery],
  );

  const toggleChannels = useCallback(
    () => setExpandedFor(expanded ? null : query),
    [expanded, query],
  );

  const onViewableItemsChanged = useRestoreLastSearchPop(listRef, rows);

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
      // FlashList по умолчанию держит видимую строку, когда сверху добавляются
      // новые: каналы, ответившие позже попсов, встали бы над экраном. Попсы
      // догружаются снизу — удерживать нечего.
      maintainVisibleContentPosition={NO_POSITION_HOLD}
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
