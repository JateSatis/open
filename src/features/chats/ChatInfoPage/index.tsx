import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { ChatInfoMenu } from './ChatInfoMenu';
import { CommonGroupsTab } from './CommonGroupsTab';
import { MediaTab } from './MediaTab';
import { MembersTab } from './MembersTab';
import { useChatInfoSummary, usePeopleStatus } from './queries';
import { SubscribeCard } from './SubscribeCard';
import { groupsSummary, mediaSummary, membersSummary, voicesSummary } from './summaries';
import { VoicesTab } from './VoicesTab';

import type { ChatSummary } from '@/api/chats';
import {
  InfoBarButton,
  InfoCard,
  InfoPage,
  InfoPersonRow,
  InfoTextRow,
  type InfoAction,
  type InfoAvatar,
  type InfoStatus,
  type InfoTab,
  useSlideBack,
} from '@/components/InfoPage';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { chatTitle, counterpart, dialogPair, isChatMember } from '@/features/chats/chatDisplay';
import { useChatSubscription } from '@/features/chats/chatSubscription';
import { JUMP_PARAM_NAMES } from '@/features/chats/jumpParams';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { MediaViewer } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { formatUsername } from '@/features/profile/username';
import { useChatCall } from '@/features/streams/useChatCall';
import { plural } from '@/lib/plural';

const CLEARED_JUMP = Object.fromEntries(JUMP_PARAM_NAMES.map((name) => [name, undefined]));

export type ChatInfoPageProps = {
  chat: ChatSummary;
};

/**
 * Страница информации о группе или личном диалоге. Участник видит свой чат;
 * посторонний — всё публичное и главное своё действие, подписку. Свой диалог
 * — по сути страница собеседника; чужой — страница «двое».
 */
export function ChatInfoPage({ chat }: ChatInfoPageProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const slideBack = useSlideBack();
  const currentUserId = useCurrentUserId();
  const online = useOnlineUsers(currentUserId);
  const chatId = chat.id;
  const isGroup = chat.kind === 'group';
  const isMember = isChatMember(chat, currentUserId);
  const other = counterpart(chat, currentUserId);
  const pair = dialogPair(chat, currentUserId);
  const { data: otherProfile } = useProfile(other?.id);
  const subscription = useChatSubscription(chatId, !isMember);
  const { data: summary } = useChatInfoSummary(chatId);
  const call = useChatCall(chatId, chat, currentUserId, isMember);
  const [photoOpen, setPhotoOpen] = useState(false);

  const people = useMemo(
    () =>
      isGroup
        ? chat.participants.map((person) => person.id)
        : other
          ? [other.id]
          : (pair ?? []).map((person) => person.id),
    [chat.participants, isGroup, other, pair],
  );
  const statuses = usePeopleStatus(people, online);

  const title = chatTitle(chat, currentUserId);
  const count = chat.participants.length;

  const openPerson = useCallback(
    (personId: string) => {
      if (personId === currentUserId) {
        router.navigate('/profile');
        return;
      }

      router.push({ pathname: '/chats/people/[userId]', params: { userId: personId } });
    },
    [currentUserId, router],
  );

  const openChat = useCallback(
    (targetChatId: string) =>
      router.push({ pathname: '/chats/[chatId]', params: { chatId: targetChatId } }),
    [router],
  );

  // К сообщению — в ту же переписку ниже в стеке, с прыжком и подсветкой.
  const { close } = slideBack;
  const showInChat = useCallback(
    (messageId: string, createdAt: string) => {
      const jump = { jumpTo: messageId, jumpAt: createdAt, jumpKey: String(Date.now()) };
      const state = navigation.getState();
      const below = state?.routes.findIndex(
        (route) =>
          route.name === '[chatId]' &&
          (route.params as { chatId?: string } | undefined)?.chatId === chatId,
      );

      if (state && below !== undefined && below !== -1) {
        navigation.dispatch({
          type: 'SET_PARAMS',
          payload: { params: { ...CLEARED_JUMP, chatId, ...jump } },
          source: state.routes[below].key,
        });
        close();
        return;
      }

      router.push({ pathname: '/chats/[chatId]', params: { chatId, ...jump } });
    },
    [chatId, close, navigation, router],
  );

  const onCopied = useCallback(() => showNotice('Скопировано'), []);

  const avatar: InfoAvatar =
    pair && pair.length === 2
      ? {
          kind: 'pair',
          first: { uri: pair[0].avatarUrl, name: pair[0].displayName },
          second: { uri: pair[1].avatarUrl, name: pair[1].displayName },
        }
      : {
          kind: 'single',
          uri: isGroup ? chat.avatarUrl : (other?.avatarUrl ?? pair?.[0]?.avatarUrl ?? null),
          name: title,
        };
  const photoUri = avatar.kind === 'single' ? avatar.uri : null;

  const status: InfoStatus | null = isGroup
    ? { text: `${count} ${plural(count, 'участник', 'участника', 'участников')}` }
    : other
      ? (statuses.get(other.id) ?? null)
      : { text: subscribersLabel(chat.subscribersCount) };

  const actions: InfoAction[] =
    !isGroup && isMember && other
      ? [
          {
            id: 'call',
            label: call.stream ? 'К звонку' : 'Звонок',
            icon: { ios: 'phone.fill', android: 'call', web: 'call' },
            onPress: call.startOrJoin,
            disabled: call.busy,
          },
        ]
      : [];

  const groupUsername = isGroup ? formatUsername(chat.username, 'group') : null;
  const personUsername = other ? formatUsername(otherProfile?.username ?? null) : null;

  const cards = (
    <>
      {!isMember ? (
        <SubscribeCard chatId={chatId} isGroup={isGroup} subscription={subscription} />
      ) : null}
      {isGroup ? (
        <InfoCard testID="info-card">
          {groupUsername ? (
            <InfoTextRow
              testID="info-group-username"
              value={groupUsername}
              caption="Имя группы"
              onCopied={onCopied}
            />
          ) : null}
        </InfoCard>
      ) : other ? (
        <InfoCard testID="info-card">
          {otherProfile?.bio?.trim() ? (
            <InfoTextRow
              testID="info-bio"
              value={otherProfile.bio.trim()}
              caption="О себе"
              onCopied={onCopied}
            />
          ) : null}
          {personUsername ? (
            <InfoTextRow
              testID="info-username"
              value={personUsername}
              caption="Имя пользователя"
              onCopied={onCopied}
            />
          ) : null}
        </InfoCard>
      ) : pair ? (
        <InfoCard testID="info-card">
          {pair.map((person) => (
            <InfoPersonRow
              key={person.id}
              testID={`info-person-${person.id}`}
              name={person.displayName}
              avatarUrl={person.avatarUrl}
              status={statuses.get(person.id) ?? null}
              onPress={() => openPerson(person.id)}
            />
          ))}
        </InfoCard>
      ) : null}
    </>
  );

  const tabs: InfoTab[] = [];
  const media = (summary?.photos ?? 0) + (summary?.videos ?? 0);

  if (isGroup) {
    tabs.push({
      key: 'members',
      title: 'Участники',
      summary: membersSummary(count),
      render: (tab) => (
        <MembersTab
          tab={tab}
          participants={chat.participants}
          currentUserId={currentUserId}
          ownerId={summary?.ownerId ?? null}
          online={online}
          statuses={statuses}
          onOpenPerson={openPerson}
        />
      ),
    });
  }

  if (media > 0) {
    tabs.push({
      key: 'media',
      title: 'Медиа',
      summary: mediaSummary(summary?.photos ?? 0, summary?.videos ?? 0),
      render: (tab) => <MediaTab tab={tab} chatId={chatId} onShowInChat={showInChat} />,
    });
  }

  if ((summary?.voices ?? 0) > 0) {
    tabs.push({
      key: 'voices',
      title: 'Голосовые',
      summary: voicesSummary(summary?.voices ?? 0),
      render: (tab) => <VoicesTab tab={tab} chatId={chatId} onShowInChat={showInChat} />,
    });
  }

  if (other && isMember && (summary?.commonGroups ?? 0) > 0) {
    tabs.push({
      key: 'groups',
      title: 'Общие группы',
      summary: groupsSummary(summary?.commonGroups ?? 0),
      render: (tab) => <CommonGroupsTab tab={tab} otherUserId={other.id} onOpenChat={openChat} />,
    });
  }

  return (
    <>
      <InfoPage
        testID="chat-info-page"
        slideBack={slideBack}
        title={title}
        status={status}
        avatar={avatar}
        actions={actions}
        cards={cards}
        tabs={tabs}
        onOpenPhoto={photoUri ? () => setPhotoOpen(true) : undefined}
        barRight={
          <>
            {isGroup && isMember ? (
              <InfoBarButton
                testID="info-edit"
                icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                accessibilityLabel="Изменить"
                onPress={() => router.push(`/chats/chat-edit/${chatId}`)}
              />
            ) : null}
            <ChatInfoMenu
              chatId={chatId}
              isMember={isMember}
              isGroup={isGroup}
              counterpartId={other?.id ?? null}
              subscription={subscription}
            />
          </>
        }
      />
      {photoUri ? (
        <MediaViewer
          visible={photoOpen}
          items={[{ id: 'avatar', kind: 'photo', url: photoUri }]}
          initialIndex={0}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
    </>
  );
}
