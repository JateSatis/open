import { useRouter } from '@/navigation';

import { isOpaquePersonId } from '@/api/opaquePeople';
import type { Subscription } from '@/api/subscriptions';
import { confirm } from '@/components/ConfirmDialog/store';
import { HeaderMenu } from '@/components/HeaderMenu';
import { InfoBarIcon } from '@/components/InfoPage';
import type { MenuAction } from '@/components/MenuList';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';

export type ChatInfoMenuItem =
  | 'search_members'
  | 'search_chat'
  | 'profile'
  | 'subscribers'
  | 'leave'
  | 'delete_chat'
  | 'mute'
  | 'unmute'
  | 'unsubscribe';

const SEARCH_MEMBERS: MenuAction<ChatInfoMenuItem> = {
  id: 'search_members',
  label: 'Поиск участников',
  icon: { ios: 'person.crop.circle.badge.questionmark', android: 'person_search', web: 'person_search' },
};
const SEARCH_CHAT: MenuAction<ChatInfoMenuItem> = {
  id: 'search_chat',
  label: 'Поиск по чату',
  icon: { ios: 'magnifyingglass', android: 'search', web: 'search' },
};
const PROFILE: MenuAction<ChatInfoMenuItem> = {
  id: 'profile',
  label: 'Профиль собеседника',
  icon: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
};
const SUBSCRIBERS: MenuAction<ChatInfoMenuItem> = {
  id: 'subscribers',
  label: 'Подписчики',
  icon: { ios: 'person.2', android: 'group', web: 'group' },
};
const LEAVE: MenuAction<ChatInfoMenuItem> = {
  id: 'leave',
  label: 'Покинуть группу',
  destructive: true,
  icon: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
};
const DELETE_CHAT: MenuAction<ChatInfoMenuItem> = {
  id: 'delete_chat',
  label: 'Удалить чат',
  destructive: true,
  icon: { ios: 'trash', android: 'delete', web: 'delete' },
};
const UNSUBSCRIBE: MenuAction<ChatInfoMenuItem> = {
  id: 'unsubscribe',
  label: 'Отписаться',
  destructive: true,
  icon: { ios: 'xmark.circle', android: 'cancel', web: 'cancel' },
};

/**
 * Пункты «⋮» страницы чата:
 * - свой диалог — поиск по чату, профиль собеседника, подписчики, удалить чат;
 * - группа, участник — поиск участников и по чату, подписчики, покинуть;
 * - посторонний — поиск по чату, подписчику ещё уведомления и отписка.
 */
export function chatInfoMenuActions(
  isMember: boolean,
  isGroup: boolean,
  subscription: Subscription | null | undefined,
): MenuAction<ChatInfoMenuItem>[] {
  if (isMember && isGroup) return [SEARCH_MEMBERS, SEARCH_CHAT, SUBSCRIBERS, LEAVE];

  if (isMember) return [SEARCH_CHAT, PROFILE, SUBSCRIBERS, DELETE_CHAT];

  if (!subscription) return [SEARCH_CHAT];

  return [
    SEARCH_CHAT,
    subscription.notify
      ? {
          id: 'mute',
          label: 'Выключить уведомления',
          icon: { ios: 'bell.slash', android: 'notifications_off', web: 'notifications_off' },
        }
      : {
          id: 'unmute',
          label: 'Включить уведомления',
          icon: { ios: 'bell', android: 'notifications', web: 'notifications' },
        },
    UNSUBSCRIBE,
  ];
}

export type ChatInfoMenuProps = {
  chatId: string;
  isMember: boolean;
  isGroup: boolean;
  /** Собеседник своего диалога — для «Профиля собеседника». */
  counterpartId: string | null;
  subscription: Subscription | null | undefined;
  onSearchMembers: () => void;
  onSearchChat: () => void;
  onLeave: () => void;
  onDeleteChat: () => void;
};

/** «⋮» справа в панели страницы чата. */
export function ChatInfoMenu({
  chatId,
  isMember,
  isGroup,
  counterpartId,
  subscription,
  onSearchMembers,
  onSearchChat,
  onLeave,
  onDeleteChat,
}: ChatInfoMenuProps) {
  const router = useRouter();
  const actions = useChatSubscriptionActions(chatId);

  const run = async (item: ChatInfoMenuItem) => {
    switch (item) {
      case 'search_members':
        onSearchMembers();
        return;
      case 'search_chat':
        onSearchChat();
        return;
      case 'leave':
        onLeave();
        return;
      case 'delete_chat':
        onDeleteChat();
        return;
      case 'subscribers':
        router.push({ name: 'Subscribers', params: { target: { kind: 'chat', id: chatId } } });
        return;
      case 'profile':
        if (counterpartId && !isOpaquePersonId(counterpartId)) {
          router.push({ name: 'Person', params: { userId: counterpartId } });
        }
        return;
      case 'mute':
        await actions.setNotify(false);
        return;
      case 'unmute':
        await actions.setNotify(true);
        return;
      case 'unsubscribe': {
        const confirmed = await confirm({
          title: isGroup ? 'Отписаться от группы?' : 'Отписаться от диалога?',
          message: 'Чат уйдёт из «Чатов».',
          confirmLabel: 'Отписаться',
          cancelLabel: 'Отмена',
          destructive: true,
        });

        if (confirmed) await actions.unsubscribe();
        return;
      }
    }
  };

  return (
    <HeaderMenu
      testID="info-menu"
      accessibilityLabel="Меню"
      actions={chatInfoMenuActions(isMember, isGroup, subscription)}
      onSelect={(item) => void run(item)}
      icon={<InfoBarIcon icon={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }} />}
    />
  );
}
