import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { styles } from './styles';

import {
  listChannelSubscribers,
  listChatSubscribers,
  SUBSCRIBERS_PAGE_SIZE,
  type Subscriber,
} from '@/api/subscriptions';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';

export const channelSubscribersQueryKey = (channelId: string) =>
  ['channel', channelId, 'subscribers'] as const;

export const chatSubscribersQueryKey = (chatId: string) =>
  ['chat', chatId, 'subscribers'] as const;

/** Чьи подписчики: канала (видит создатель) или чужого диалога и группы (видят участники). */
export type SubscribersTarget = { kind: 'channel'; id: string } | { kind: 'chat'; id: string };

export type SubscribersScreenProps = { target: SubscribersTarget };

const subscriberKey = (subscriber: Subscriber) => subscriber.id;

/**
 * Подписчики канала или чата: свежие сверху, страницами, у читателей канала
 * пометка «в чатах» (у чата уровень один — пометки нет). Тап — профиль.
 * Остальным база этот список не отдаёт.
 */
export function SubscribersScreen({ target }: SubscribersScreenProps) {
  const theme = useTheme();
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const query = useInfiniteQuery({
    queryKey:
      target.kind === 'channel'
        ? channelSubscribersQueryKey(target.id)
        : chatSubscribersQueryKey(target.id),
    queryFn: ({ pageParam }) =>
      target.kind === 'channel'
        ? listChannelSubscribers(target.id, pageParam)
        : listChatSubscribers(target.id, pageParam),
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
      if (userId === currentUserId) router.navigate('/profile');
      else router.push(`/chats/people/${userId}`);
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
      testID="subscribers-list"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.list}
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
                @{item.username}
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
