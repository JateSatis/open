import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import type { ChatSummary } from '@/api/chats';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { counterpart } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { Spacing } from '@/theme';

export default function ChatsScreen() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const onlineIds = useOnlineUsers(currentUserId);
  const { chats, isLoading, isRefreshing, error, refresh } = useChats();

  const openChat = useCallback((chatId: string) => router.push(`/chats/${chatId}`), [router]);

  const renderItem = useCallback(
    ({ item }: { item: ChatSummary }) => (
      <ChatListItem
        chat={item}
        currentUserId={currentUserId}
        isOnline={onlineIds.has(counterpart(item, currentUserId)?.id ?? '')}
        onPress={openChat}
      />
    ),
    [currentUserId, onlineIds, openChat],
  );

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Загрузка чатов" />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}>
      {error ? (
        <View style={{ paddingVertical: Spacing.two }}>
          <Text color="danger">{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={chats}
        keyExtractor={(chat) => chat.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          error ? null : (
            <Text color="textSecondary">
              Чатов пока нет. Начните диалог — его сможет прочитать кто угодно.
            </Text>
          )
        }
      />
    </Screen>
  );
}
