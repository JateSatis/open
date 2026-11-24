import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouteParams, useRouter } from '@/navigation';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { styles } from './styles';

import {
  listChannelSubscribers,
  listChatSubscribers,
  SUBSCRIBERS_PAGE_SIZE,
  type Subscriber,
} from '@/api/subscriptions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { formatUsername } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';
import { describeLoadError } from '@/lib/network';

export const channelSubscribersQueryKey = (channelId: string) =>
  ['channel', channelId, 'subscribers'] as const;

export const chatSubscribersQueryKey = (chatId: string) => ['chat', chatId, 'subscribers'] as const;

const subscriberKey = (subscriber: Subscriber) => subscriber.id;

/**
 * Подписчики канала или чата: свежие сверху, страницами, у читателей канала
 * пометка «в чатах» (у чата уровень один — пометки нет). Тап — профиль.
 * Остальным база этот список не отдаёт.
 */
export function SubscribersScreen() {
  const api = useRequestClient();
  const { target } = useRouteParams<'Subscribers'>();
  const theme = useTheme();
  // Список доходит до края окна: панели вкладок под экраном нет.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const query = useInfiniteQuery({
    queryKey:
      target.kind === 'channel'
        ? channelSubscribersQueryKey(target.id)
        : chatSubscribersQueryKey(target.id),
    queryFn: ({ pageParam }) =>
      target.kind === 'channel'
        ? listChannelSubscribers(target.id, pageParam, undefined, api)
        : listChatSubscribers(target.id, pageParam, api),
    initialPageParam: null as Subscriber | null,
    getNextPageParam: (last) =>
      last.length < SUBSCRIBERS_PAGE_SIZE ? undefined : last[last.length - 1],
  });
  const subscribers = query.data?.pages.flat() ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const openPerson = useCallback(
    (userId: string) => {
      if (userId === currentUserId) router.navigate({ name: 'Tabs', params: { screen: 'profile' } });
      else router.push({ name: 'Person', params: { userId } });
    },
    [currentUserId, router],
  );

  if (query.isPending) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator accessibilityLabel="Загрузка подписчиков" />
      </View>
    );
  }

  return (
    <FlatList
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      testID="subscribers-list"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.list, { paddingBottom: Spacing.two + insets.bottom }]}
      data={subscribers}
      keyExtractor={subscriberKey}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <Pressable
          testID="subscriber-row"
          accessibilityRole="button"
          accessibilityLabel={item.displayName}
          onPress={() => openPerson(item.userId)}
          style={({ pressed }) => [
            styles.row,
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}
        >
          <Avatar uri={item.avatarUrl} name={item.displayName} />
          <View style={styles.body}>
            <Text variant="bodyBold" numberOfLines={1}>
              {item.displayName}
            </Text>
            {item.username ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {formatUsername(item.username)}
              </Text>
            ) : null}
          </View>
          {item.inChats ? (
            <Text variant="caption" color="textSecondary">
              в чатах
            </Text>
          ) : null}
        </Pressable>
      )}
      ListEmptyComponent={
        <Text color={query.error ? 'danger' : 'textSecondary'} style={styles.empty}>
          {query.error
            ? (describeLoadError(query.error, 'Не удалось загрузить подписчиков') ?? 'Нет связи')
            : 'Подписчиков пока нет.'}
        </Text>
      }
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator accessibilityLabel="Загрузка подписчиков" /> : null
      }
    />
  );
}
