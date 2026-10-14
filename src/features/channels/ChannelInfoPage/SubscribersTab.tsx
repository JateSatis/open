import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { channelInfoKeys, useChannelSubscribers } from './queries';

import { InfoPersonRow, InfoTabList } from '@/components/InfoPage';
import { Text } from '@/components/Text';
import { matchesPerson } from '@/features/chats/ChatInfoPage/MembersTab';
import { usePeopleStatus } from '@/features/chats/ChatInfoPage/queries';
import { TabStatus, tabStatusOf } from '@/features/chats/ChatInfoPage/TabStatus';
import { useDebounced } from '@/lib/useDebounced';
import { Spacing } from '@/theme';

/** Пауза после последней буквы, прежде чем спрашивать сервер. */
const SEARCH_DEBOUNCE_MS = 300;

export type SubscribersTabProps = {
  tab: number;
  channelId: string;
  online: Set<string>;
  /** Поиск: `null` — закрыт, весь список. */
  query: string | null;
  onOpenPerson: (userId: string) => void;
};

/**
 * Вкладка «Подписчики» — только владельцу: свежие сверху, страницами, справа
 * «читатель», если канал у человека в «Чатах». Поиск — по уже загруженным,
 * пока загружены все; иначе — на сервере.
 */
export function SubscribersTab({ tab, channelId, online, query, onOpenPerson }: SubscribersTabProps) {
  const queryClient = useQueryClient();
  const needle = (query ?? '').trim();
  const debounced = useDebounced(needle, SEARCH_DEBOUNCE_MS);
  const all = useChannelSubscribers(channelId, '', true);
  const allLoaded = all.data !== undefined && !all.hasNextPage;
  const remote = useChannelSubscribers(channelId, debounced, debounced !== '' && !allLoaded);
  const searchingRemotely = needle !== '' && !allLoaded;
  const source = searchingRemotely ? remote : all;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = source;

  const rows = useMemo(() => {
    const loaded = source.data?.pages.flat() ?? [];

    return needle && !searchingRemotely
      ? loaded.filter((row) =>
          matchesPerson(
            { id: row.userId, displayName: row.displayName, avatarUrl: row.avatarUrl, username: row.username },
            needle,
          ),
        )
      : loaded;
  }, [needle, searchingRemotely, source.data]);

  const ids = useMemo(() => rows.map((row) => row.userId), [rows]);
  const statuses = usePeopleStatus(ids, online);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const retry = useCallback(() => {
    if (source.data === undefined) {
      void queryClient.resetQueries({
        queryKey: channelInfoKeys.subscribers(channelId, searchingRemotely ? debounced : ''),
        exact: true,
      });
    } else {
      void fetchNextPage();
    }
  }, [channelId, debounced, fetchNextPage, queryClient, searchingRemotely, source.data]);

  // Ответ сервера на новый запрос ещё не пришёл — не «никого».
  const waiting =
    source.data === undefined || (searchingRemotely && (debounced !== needle || remote.isFetching));

  return (
    <InfoTabList
      tab={tab}
      testID="info-subscribers"
      data={rows}
      keyExtractor={(row) => row.id}
      extraData={statuses}
      keyboardShouldPersistTaps="handled"
      onEndReached={loadMore}
      onEndReachedThreshold={1}
      ListEmptyComponent={
        waiting && source.status !== 'error' ? (
          <View style={styles.empty}>
            <ActivityIndicator accessibilityLabel="Загрузка подписчиков" />
          </View>
        ) : source.status !== 'error' ? (
          <View style={styles.empty}>
            <Text color="textSecondary">
              {needle ? 'Никого не нашлось' : 'Подписчиков пока нет'}
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <InfoPersonRow
          testID={`info-subscriber-${item.userId}`}
          name={item.displayName}
          avatarUrl={item.avatarUrl}
          status={statuses.get(item.userId) ?? null}
          badge={item.inChats ? 'читатель' : undefined}
          onPress={() => onOpenPerson(item.userId)}
        />
      )}
      footer={<TabStatus state={tabStatusOf(source)} what="подписчиков" onRetry={retry} />}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
});
