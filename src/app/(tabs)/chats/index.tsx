import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TabBar, useTabBarHeight } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { sectionToOpen } from '@/features/channels/sectionToOpen';
import {
  SubscriptionRowMenu,
  type SubscriptionRowTarget,
} from '@/features/channels/SubscriptionRowMenu';
import { ChatListItem, type RowRect } from '@/features/chats/ChatListItem';
import { CreateMenu, type CreateMenuItem } from '@/features/chats/CreateMenu';
import { InvitesEntry } from '@/features/chats/InvitesEntry';
import { counterpart } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useInvites } from '@/features/chats/useInvites';
import type { ChatSummary } from '@/api/chats';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { ConnectionBanner } from '@/features/connection/ConnectionBanner';
import { SavedEntry } from '@/features/saved/SavedEntry';
import { useSavedSummary } from '@/features/saved/useSavedSummary';
import { SearchBar } from '@/features/search/SearchBar';
import { SearchPanel } from '@/features/search/SearchPanel';
import { useSearchMode } from '@/features/search/useSearchMode';
import { Sizes, Spacing } from '@/theme';

export default function ChatsScreen() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const { chats, isLoading, isRefreshing, error, refresh } = useChats();
  // Точка «в сети» — только у собеседников личных диалогов.
  const peerIds = useMemo(
    () =>
      chats.flatMap((chat) => {
        const peer = chat.kind === 'direct' ? counterpart(chat, currentUserId) : null;

        return peer ? [peer.id] : [];
      }),
    [chats, currentUserId],
  );
  const onlineIds = useOnlineUsers(peerIds);
  const { incoming, declined, error: invitesError, refresh: refreshInvites } = useInvites();
  const watchLaterCount = useSavedSummary();

  const [rowMenu, setRowMenu] = useState<SubscriptionRowTarget | null>(null);
  const search = useSearchMode();
  const tabBarHeight = useTabBarHeight();
  // Последняя строка списка докручивается над кнопкой «+», а та стоит над вкладками.
  const listBottomInset = tabBarHeight + Sizes.floatingButton + Sizes.floatingButtonMargin * 2;

  const openChat = useCallback(
    (chatId: string) => {
      const chat = chats.find((item) => item.id === chatId);
      const channelId = chat?.channel?.id;

      if (!chat || !channelId) {
        router.push(`/chats/${chatId}`);
        return;
      }

      router.push({
        pathname: '/chats/channel/[channelId]',
        params: { channelId, section: sectionToOpen(chat) },
      });
    },
    [chats, router],
  );
  // Меню — только у каналов, на которые я подписан: в своих чатах и своём
  // канале долгое нажатие пока ничего не делает.
  const openRowMenu = useCallback(
    (chat: ChatSummary, rect: RowRect) => setRowMenu({ chat, rect }),
    [],
  );
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const onCreate = useCallback(
    (item: CreateMenuItem) => {
      // «Чат» — выбор людей: один человек — диалог, несколько — группа.
      router.push(item === 'chat' ? '/chats/new' : '/chats/new-channel');
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
      <Screen edges={['top']} overlay={<TabBar active="chats" />}>
        <ActivityIndicator accessibilityLabel="Загрузка чатов" />
      </Screen>
    );
  }

  return (
    // Экран доходит до низа: панель вкладок лежит поверх списка и сама
    // отступает от системной навигации.
    <Screen
      edges={['top']}
      contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}
      // «+» — поверх панели: дымка над значками не заходит на кнопку.
      overlay={<TabBar active="chats" />}
    >
      <ConnectionBanner style={{ marginHorizontal: -Spacing.three }} />

      <SearchBar
        value={search.query}
        onChangeText={search.setQuery}
        active={search.active}
        onActivate={search.activate}
        onCancel={search.cancel}
      />

      {problem && !search.active ? (
        <View style={{ paddingVertical: Spacing.two }}>
          <Text color="danger">{problem}</Text>
        </View>
      ) : null}

      {search.active ? (
        <SearchPanel query={search.query} />
      ) : (
        <FlatList
          showsHorizontalScrollIndicator={false}
          // Список — в оставшееся под поиском место, не во весь экран: иначе
          // он вытягивал экран за нижний край, и кнопка «+» уезжала туда же.
          style={{ flex: 1 }}
          data={chats}
          contentContainerStyle={{ paddingBottom: listBottomInset }}
          keyExtractor={(chat) => chat.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} />}
          // «Сохранённые» — всегда первой строкой, на одном месте; заявки
          // появляются и пропадают под ней, её не сдвигая.
          ListHeaderComponent={
            <>
              <SavedEntry
                watchLaterCount={watchLaterCount}
                onPress={() => router.push('/chats/saved')}
              />
              {hasInvites ? (
                <InvitesEntry
                  incomingCount={incoming.length}
                  onPress={() => router.push('/chats/invites')}
                />
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <ChatListItem
              chat={item}
              currentUserId={currentUserId}
              isOnline={onlineIds.has(counterpart(item, currentUserId)?.id ?? '')}
              onPress={openChat}
              onLongPress={item.subscription ? openRowMenu : undefined}
            />
          )}
          ListEmptyComponent={
            problem ? null : (
              <View style={{ gap: Spacing.three, paddingTop: Spacing.three }}>
                <Text color="textSecondary">
                  Чатов пока нет. Позовите кого-нибудь — всё, что здесь появится, сможет прочитать
                  кто угодно.
                </Text>
                <Button label="Новый чат" onPress={() => router.push('/chats/new')} />
              </View>
            )
          }
        />
      )}

      {search.active ? null : <CreateMenu onSelect={onCreate} bottomInset={tabBarHeight} />}

      <SubscriptionRowMenu target={rowMenu} onClosed={closeRowMenu} />
    </Screen>
  );
}
