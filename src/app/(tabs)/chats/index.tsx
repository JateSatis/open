import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { CreateMenu, type CreateMenuItem } from '@/features/chats/CreateMenu';
import { InvitesEntry } from '@/features/chats/InvitesEntry';
import { counterpart } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useInvites } from '@/features/chats/useInvites';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { Sizes, Spacing } from '@/theme';

/** Последняя строка списка встаёт над кнопкой «+», а не под неё. */
const LIST_BOTTOM_INSET = Sizes.floatingButton + Sizes.floatingButtonMargin * 2;

export default function ChatsScreen() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const onlineIds = useOnlineUsers(currentUserId);
  const { chats, isLoading, isRefreshing, error, refresh } = useChats();
  const { incoming, declined, error: invitesError, refresh: refreshInvites } = useInvites();

  const openChat = useCallback(
    (chatId: string) => {
      const channelId = chats.find((chat) => chat.id === chatId)?.channel?.id;

      router.push(channelId ? `/chats/channel/${channelId}` : `/chats/${chatId}`);
    },
    [chats, router],
  );
  const onCreate = useCallback(
    (item: CreateMenuItem) => {
      // «Групповой чат» пока только закрывает меню: создание группы — отдельная задача.
      if (item === 'channel') router.push('/chats/new-channel');
    },
    [router],
  );
  const refreshAll = useCallback(() => {
    refresh();
    refreshInvites();
  }, [refresh, refreshInvites]);

  // Отклонённые тоже ведут сюда: иначе передумать и принять было бы негде.
  const hasInvites = incoming.length > 0 || declined.length > 0;
  const problem = error ?? invitesError;

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Загрузка чатов" />
      </Screen>
    );
  }

  return (
    // Низ экрана — верх нативной панели вкладок: она сама отступает от
    // системной навигации, и второй отступ поднял бы кнопку «+» выше, чем она
    // отстоит от правого края.
    <Screen
      edges={['top']}
      contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}
    >
      {problem ? (
        <View style={{ paddingVertical: Spacing.two }}>
          <Text color="danger">{problem}</Text>
        </View>
      ) : null}

      <FlatList
        data={chats}
        contentContainerStyle={{ paddingBottom: LIST_BOTTOM_INSET }}
        keyExtractor={(chat) => chat.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} />}
        ListHeaderComponent={
          hasInvites ? (
            <InvitesEntry
              incomingCount={incoming.length}
              onPress={() => router.push('/chats/invites')}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            currentUserId={currentUserId}
            isOnline={onlineIds.has(counterpart(item, currentUserId)?.id ?? '')}
            onPress={openChat}
          />
        )}
        ListEmptyComponent={
          problem ? null : (
            <View style={{ gap: Spacing.three, paddingTop: Spacing.three }}>
              <Text color="textSecondary">
                Чатов пока нет. Позовите кого-нибудь — всё, что здесь появится, сможет прочитать кто
                угодно.
              </Text>
              <Button label="Новый чат" onPress={() => router.push('/chats/new')} />
            </View>
          )
        }
      />

      <CreateMenu onSelect={onCreate} />
    </Screen>
  );
}
