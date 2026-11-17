import { useNavigation, useRouter } from '@/navigation';
import { useCallback, useMemo, useState } from 'react';

import { ChatInfoCards } from './ChatInfoCards';
import { ChatInfoMenu } from './ChatInfoMenu';
import { chatInfoTabs } from './chatInfoTabs';
import { useChatInfoSummary, usePeopleStatus } from './queries';
import { useGroupActions } from './useGroupActions';

import { isOpaquePersonId } from '@/api/opaquePeople';
import type { ChatSummary } from '@/api/chats';
import {
  InfoBarButton,
  InfoPage,
  type InfoAction,
  type InfoAvatar,
  type InfoPageHandle,
  type InfoStatus,
  type SlideBack,
} from '@/components/InfoPage';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { chatTitle, counterpart, dialogPair, isChatMember } from '@/features/chats/chatDisplay';
import { useChatSubscription } from '@/features/chats/chatSubscription';
import { useChatChangedSignal } from '@/features/chats/useChatChangedSignal';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { MediaViewer } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { useChatCall } from '@/features/streams/useChatCall';
import { plural } from '@/lib/plural';

const CLEARED_SEARCH = Object.fromEntries(
  ['search', 'searchKey'].map((name) => [name, undefined]),
);

export type ChatInfoPageProps = {
  chat: ChatSummary;
  /** Въезд и уход — общие с заглушкой, пока чат грузился: страница не въезжает дважды. */
  slideBack: SlideBack;
};

/**
 * Страница информации о группе или личном диалоге. Участник видит свой чат;
 * посторонний — всё публичное и главное своё действие, подписку. Свой диалог
 * — по сути страница собеседника; чужой — страница «двое».
 */
export function ChatInfoPage({ chat, slideBack }: ChatInfoPageProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const currentUserId = useCurrentUserId();
  const chatId = chat.id;
  const isGroup = chat.kind === 'group';
  const isMember = isChatMember(chat, currentUserId);
  const isOwner = isGroup && isMember && chat.ownerId === currentUserId;
  const other = counterpart(chat, currentUserId);
  // Новый массив на каждый рендер пересчитывал бы статусы людей каждый раз.
  const pair = useMemo(() => dialogPair(chat, currentUserId), [chat, currentUserId]);
  const { data: otherProfile } = useProfile(other?.id);
  const subscription = useChatSubscription(chatId, !isMember);
  const summaryQuery = useChatInfoSummary(chatId);
  const summary = summaryQuery.data;
  const call = useChatCall(chatId, chat, currentUserId, isMember);
  const groupActions = useGroupActions(chat, currentUserId);
  // Хэндл страницы — состоянием, а не ref: им пользуются обработчики вкладок.
  const [page, setPage] = useState<InfoPageHandle | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Поиск участников: `null` — закрыт.
  const [memberQuery, setMemberQuery] = useState<string | null>(null);

  // Описание, состав, фото меняются, пока страница открыта, — и у постороннего.
  useChatChangedSignal(chatId);

  const people = useMemo(
    () =>
      isGroup
        ? chat.participants.map((person) => person.id)
        : other
          ? [other.id]
          : (pair ?? []).map((person) => person.id),
    [chat.participants, isGroup, other, pair],
  );
  const statuses = usePeopleStatus(people);
  const online = useOnlineUsers(people);

  const title = chatTitle(chat, currentUserId);
  const count = chat.participants.length;

  const openPerson = useCallback(
    (personId: string) => {
      if (personId === currentUserId) {
        router.navigate({ name: 'Tabs', params: { screen: 'profile' } });
        return;
      }

      // Подменённый в диалоге: id непрозрачный, профиля за ним нет.
      if (isOpaquePersonId(personId)) return;

      router.push({ name: 'Person', params: { userId: personId } });
    },
    [currentUserId, router],
  );

  const openChat = useCallback(
    (targetChatId: string) =>
      router.push({ name: 'Chat', params: { chatId: targetChatId } }),
    [router],
  );

  // В ту же переписку ниже в стеке — в режим поиска.
  const { close } = slideBack;
  const toThisChat = useCallback(
    (params: Record<string, string>) => {
      const state = navigation.getState();
      const below = state?.routes[state.index - 1];
      if (below?.name === 'Chat' && (below.params as {chatId?: string})?.chatId === chatId) {
        navigation.dispatch({
          type: 'SET_PARAMS',
          payload: { params: { ...CLEARED_SEARCH, chatId, ...params } },
          source: below.key,
        });
        close();
        return;
      }

      router.push({ name: 'Chat', params: { chatId, ...params } });
    },
    [chatId, close, navigation, router],
  );

  const searchChat = useCallback(
    () => toThisChat({ search: '1', searchKey: String(Date.now()) }),
    [toThisChat],
  );

  const searchMembers = useCallback(() => {
    page?.focusTab('members');
    setMemberQuery((current) => current ?? '');
  }, [page]);
  const closeMemberSearch = useCallback(() => setMemberQuery(null), []);

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

  const actions: InfoAction[] = [];

  if (!isGroup && isMember && other) {
    actions.push({
      id: 'call',
      label: call.stream ? 'К звонку' : 'Звонок',
      icon: { ios: 'phone.fill', android: 'call', web: 'call' },
      onPress: call.startOrJoin,
      disabled: call.busy,
    });
  }

  if (isGroup && isMember) {
    actions.push({
      id: 'leave',
      label: 'Покинуть',
      icon: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
      onPress: () => void groupActions.leave(),
    });
  }

  const tabs = chatInfoTabs({
    chat,
    summary,
    isMember,
    other,
    currentUserId,
    online,
    statuses,
    memberQuery,
    onOpenPerson: openPerson,
    onOpenChat: openChat,
    onRemoveMember: (person) => void groupActions.removeMember(person),
    onCancelInvite: (person) => void groupActions.cancelInvite(person),
    onSearchMembers: searchMembers,
  });

  return (
    <>
      <InfoPage
        ref={setPage}
        testID="chat-info-page"
        slideBack={slideBack}
        title={title}
        status={status}
        avatar={avatar}
        actions={actions}
        cards={
          <ChatInfoCards
            chat={chat}
            isMember={isMember}
            other={other}
            otherProfile={otherProfile}
            pair={pair}
            statuses={statuses}
            subscription={subscription}
            summaryFailed={summary === undefined && summaryQuery.isError}
            onRetrySummary={() => void summaryQuery.refetch()}
            onCopied={onCopied}
            onOpenPerson={openPerson}
            onAddMembers={() =>
              router.push({ name: 'ChatInvite', params: { chatId } })
            }
          />
        }
        tabs={tabs}
        onOpenPhoto={photoUri ? () => setPhotoOpen(true) : undefined}
        search={
          memberQuery === null
            ? null
            : {
                value: memberQuery,
                onChangeText: setMemberQuery,
                onClose: closeMemberSearch,
                placeholder: 'Поиск участников',
              }
        }
        barRight={
          <>
            {isOwner ? (
              <InfoBarButton
                testID="info-edit"
                icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                accessibilityLabel="Изменить"
                onPress={() => router.push({ name: 'EditDetails', params: { target: { kind: 'chat', id: chatId } } })}
              />
            ) : null}
            <ChatInfoMenu
              chatId={chatId}
              isMember={isMember}
              isGroup={isGroup}
              counterpartId={other?.id ?? null}
              subscription={subscription}
              onSearchMembers={searchMembers}
              onSearchChat={searchChat}
              onLeave={() => void groupActions.leave()}
              onDeleteChat={() => void groupActions.deleteDialog()}
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
