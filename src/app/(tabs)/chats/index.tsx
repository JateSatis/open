import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';

import type { ChatSummary, DirectCandidate } from '@/api/chats';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { UserListItem } from '@/features/chats/UserListItem';
import { counterpart } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useDirectCandidates } from '@/features/chats/useDirectCandidates';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { useOpenDirectChat } from '@/features/chats/useOpenDirectChat';
import { Spacing } from '@/theme';

// Секции держат разные сущности, но SectionList требует один тип строки на
// список — отсюда размеченное объединение вместо двух отдельных списков.
type Row =
  | { key: string; kind: 'chat'; chat: ChatSummary }
  | { key: string; kind: 'person'; user: DirectCandidate };

type Section = { title: string; data: Row[] };

export default function ChatsScreen() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const onlineIds = useOnlineUsers(currentUserId);
  const { chats, isLoading, isRefreshing, error, refresh } = useChats();
  const { candidates, error: candidatesError } = useDirectCandidates();
  const { pendingUserId, error: openError, open } = useOpenDirectChat();

  const openChat = useCallback((chatId: string) => router.push(`/chats/${chatId}`), [router]);

  const sections = useMemo((): Section[] => {
    const talkingTo = new Set(
      chats.flatMap((chat) => chat.participants.map((participant) => participant.id)),
    );
    // Человек, с которым переписка уже есть, живёт в разделе чатов — иначе он
    // оказался бы в списке дважды, с двумя разными способами открыть одно и то
    // же.
    const newcomers = candidates.filter((candidate) => !talkingTo.has(candidate.id));

    return [
      ...(chats.length > 0
        ? [
            {
              title: 'Чаты',
              data: chats.map((chat): Row => ({ key: chat.id, kind: 'chat', chat })),
            },
          ]
        : []),
      ...(newcomers.length > 0
        ? [
            {
              title: 'Все пользователи',
              data: newcomers.map((user): Row => ({ key: user.id, kind: 'person', user })),
            },
          ]
        : []),
    ];
  }, [candidates, chats]);

  const problem = error ?? candidatesError ?? openError;

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Загрузка чатов" />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}>
      {problem ? (
        <View style={{ paddingVertical: Spacing.two }}>
          <Text color="danger">{problem}</Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        renderSectionHeader={({ section }) => (
          <View style={{ paddingTop: Spacing.three, paddingBottom: Spacing.one }}>
            <Text variant="smallBold" color="textSecondary">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) =>
          item.kind === 'chat' ? (
            <ChatListItem
              chat={item.chat}
              currentUserId={currentUserId}
              isOnline={onlineIds.has(counterpart(item.chat, currentUserId)?.id ?? '')}
              onPress={openChat}
            />
          ) : (
            <UserListItem
              user={item.user}
              isOnline={onlineIds.has(item.user.id)}
              isOpening={pendingUserId === item.user.id}
              onPress={open}
            />
          )
        }
        ListEmptyComponent={
          problem ? null : (
            <Text color="textSecondary">
              Пока некому написать: в Open вы первый. Всё, что здесь появится, сможет прочитать кто
              угодно.
            </Text>
          )
        }
      />
    </Screen>
  );
}
