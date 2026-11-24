import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRouter } from '@/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';

import { FeedSearchRowView } from './FeedSearchRowView';
import { POP_GAP, styles } from './styles';
import { useRestoreLastSearchPop } from './useRestoreLastSearchPop';

import type { SearchEntity, SearchPop } from '@/api/search';
import { useTabBarHeight } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOpenPopViewer } from '@/features/pops/openPopViewer';
import {
  buildFeedSearchRows,
  FEED_POP_COLUMNS,
  type FeedSearchRow,
} from '@/features/search/feedSearchRows';
import { setLastSearchPop } from '@/features/search/lastSearchPop';
import { feedRecentQueries } from '@/features/search/recentSearches';
import { COLLAPSED_ROWS } from '@/features/search/searchSections';
import { useFeedSearch } from '@/features/search/useFeedSearch';
import { logSearchQuery, logSearchResultOpened } from '@/features/recs/journal/searchJournal';
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
  const openPopViewer = useOpenPopViewer();
  const router = useRouter();
  const results = useFeedSearch(query);
  const recent = feedRecentQueries.useStore((state) => state.items);
  const currentUserId = useCurrentUserId();
  const tabBarHeight = useTabBarHeight();
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

  // Журнал: выдача по запросу пришла.
  useEffect(() => {
    if (!results.isSearching && !results.notice) {
      logSearchQuery('feed', results.shownQuery, {
        channels: results.channels.length,
        pops: results.pops.length,
      });
    }
  }, [
    results.channels.length,
    results.isSearching,
    results.notice,
    results.pops.length,
    results.shownQuery,
  ]);

  const remember = useCallback(() => {
    const text = query.trim();

    if (text) feedRecentQueries.add(text);
  }, [query]);

  const openChannel = useCallback(
    (entity: SearchEntity) => {
      remember();
      logSearchResultOpened(
        'feed',
        { type: 'channel', id: entity.id },
        {
          kind: 'channel',
          section: 'channels',
          position: results.channels.findIndex((channel) => channel.id === entity.id),
          query: results.shownQuery,
        },
      );
      router.push({ name: 'Channel', params: { channelId: entity.id } });
    },
    [remember, results.channels, results.shownQuery, router],
  );

  const { shownQuery } = results;
  const openPop = useCallback(
    (pop: SearchPop) => {
      remember();
      logSearchResultOpened(
        'feed',
        { type: 'pop', id: pop.id },
        {
          kind: 'pop',
          section: 'pops',
          position: results.pops.findIndex((item) => item.id === pop.id),
          query: shownQuery,
        },
      );
      setLastSearchPop(pop);
      openPopViewer({ source: 'search', query: shownQuery, startId: pop.id });
    },
    [openPopViewer, remember, results.pops, shownQuery],
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
        results.channels.length > COLLAPSED_ROWS ? { expanded, onPress: toggleChannels } : null
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
      showsHorizontalScrollIndicator={false}
      ref={listRef}
      testID="feed-search-results"
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.type}
      showsVerticalScrollIndicator={false}
      renderItem={renderItem}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      // FlashList по умолчанию держит видимую строку, когда сверху добавляются
      // новые: каналы, ответившие позже попсов, встали бы над экраном. Попсы
      // догружаются снизу — удерживать нечего.
      maintainVisibleContentPosition={NO_POSITION_HOLD}
      // Выдача уходит под панель вкладок, последняя строка докручивается над ней.
      contentContainerStyle={{ paddingBottom: tabBarHeight + Spacing.three }}
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
