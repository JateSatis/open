import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';

import type { ChatInvite } from '@/api/invites';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { InviteCard } from '@/features/chats/InviteCard';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useInvites } from '@/features/chats/useInvites';
import { useRespondToInvite } from '@/features/chats/useRespondToInvite';
import { Spacing } from '@/theme';

type Section = { title: string; data: ChatInvite[] };

export default function InvitesScreen() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const { incoming, declined, isLoading, isRefreshing, error, refresh } = useInvites();
  const { pending, error: respondError, respond } = useRespondToInvite();

  const openChat = useCallback((chatId: string) => router.push(`/chats/${chatId}`), [router]);
  const openPerson = useCallback(
    (userId: string) =>
      userId === currentUserId ? router.navigate('/profile') : router.push(`/chats/people/${userId}`),
    [currentUserId, router],
  );
  const accept = useCallback((chatId: string) => respond(chatId, 'accept'), [respond]);
  const decline = useCallback((chatId: string) => respond(chatId, 'decline'), [respond]);

  const sections = useMemo(
    (): Section[] => [
      ...(incoming.length > 0 ? [{ title: 'Входящие', data: incoming }] : []),
      ...(declined.length > 0 ? [{ title: 'Отклонённые', data: declined }] : []),
    ],
    [declined, incoming],
  );

  if (isLoading) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator accessibilityLabel="Загрузка заявок" />
      </Screen>
    );
  }

  const problem = error ?? respondError;

  return (
    <Screen
      edges={['bottom']}
      contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}
    >
      {problem ? (
        <View style={{ paddingVertical: Spacing.two }}>
          <Text color="danger">{problem}</Text>
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(invite) => invite.chatId}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        renderSectionHeader={({ section }) => (
          <View style={{ paddingTop: Spacing.three, paddingBottom: Spacing.two }}>
            <Text variant="smallBold" color="textSecondary">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <InviteCard
            invite={item}
            currentUserId={currentUserId}
            responding={pending?.chatId === item.chatId ? pending.answer : null}
            onOpen={openChat}
            onAccept={accept}
            onDecline={decline}
            onOpenPerson={openPerson}
          />
        )}
        ListEmptyComponent={
          problem ? null : (
            <View style={{ paddingTop: Spacing.three }}>
              <Text color="textSecondary">Заявок нет.</Text>
            </View>
          )
        }
      />
    </Screen>
  );
}
