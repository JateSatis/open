import { useRouter } from 'expo-router';

import type { Subscription } from '@/api/subscriptions';
import { confirm } from '@/components/ConfirmDialog/store';
import { HeaderMenu } from '@/components/HeaderMenu';
import { InfoBarIcon } from '@/components/InfoPage';
import type { MenuAction } from '@/components/MenuList';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';

export type ChatInfoMenuItem = 'subscribers' | 'profile' | 'mute' | 'unmute' | 'unsubscribe';

/**
 * Пункты «⋮» страницы чата: участнику — «Подписчики», в своём диалоге ещё
 * «Профиль собеседника» (путь к «Написать» и «Диалогам», пока профиль не
 * переехал на эту страницу); подписчику — уведомления и отписка.
 */
export function chatInfoMenuActions(
  isMember: boolean,
  hasCounterpart: boolean,
  subscription: Subscription | null | undefined,
): MenuAction<ChatInfoMenuItem>[] {
  if (isMember) {
    return [
      ...(hasCounterpart
        ? [
            {
              id: 'profile' as const,
              label: 'Профиль собеседника',
              icon: {
                ios: 'person.crop.circle',
                android: 'account_circle',
                web: 'account_circle',
              } as const,
            },
          ]
        : []),
      {
        id: 'subscribers',
        label: 'Подписчики',
        icon: { ios: 'person.2', android: 'group', web: 'group' },
      },
    ];
  }

  if (!subscription) return [];

  return [
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
    {
      id: 'unsubscribe',
      label: 'Отписаться',
      destructive: true,
      icon: { ios: 'xmark.circle', android: 'cancel', web: 'cancel' },
    },
  ];
}

export type ChatInfoMenuProps = {
  chatId: string;
  isMember: boolean;
  isGroup: boolean;
  /** Собеседник своего диалога — для «Профиля собеседника». */
  counterpartId: string | null;
  subscription: Subscription | null | undefined;
};

/** «⋮» справа в панели страницы чата. */
export function ChatInfoMenu({
  chatId,
  isMember,
  isGroup,
  counterpartId,
  subscription,
}: ChatInfoMenuProps) {
  const router = useRouter();
  const actions = useChatSubscriptionActions(chatId);

  const run = async (item: ChatInfoMenuItem) => {
    switch (item) {
      case 'subscribers':
        router.push({ pathname: '/chats/chat-subscribers/[chatId]', params: { chatId } });
        return;
      case 'profile':
        if (counterpartId) {
          router.push({ pathname: '/chats/people/[userId]', params: { userId: counterpartId } });
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
      actions={chatInfoMenuActions(isMember, counterpartId !== null, subscription)}
      onSelect={(item) => void run(item)}
      icon={<InfoBarIcon icon={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }} />}
    />
  );
}
