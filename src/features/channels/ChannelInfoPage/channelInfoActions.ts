import type { ChannelSubscription } from '@/api/subscriptions';
import type { InfoAction } from '@/components/InfoPage';

import type { ChannelRole } from './ChannelInfoMenu';

export type ChannelInfoActionHandlers = {
  onNewPop: () => void;
  onSubscribers: () => void;
  onSetInChats: (value: boolean) => void;
  onSetNotify: (enabled: boolean) => void;
  onUnsubscribe: () => void;
};

const UNSUBSCRIBE_ICON = { ios: 'xmark.circle', android: 'cancel', web: 'cancel' } as const;

/**
 * Кнопки под названием канала по тому, кто я ему:
 * - посторонний — нет (главное действие в карточке ниже);
 * - подписчик — «Добавить в чаты», «Отписаться»;
 * - читатель — «Без звука» / «Включить звук», «Убрать из чатов», «Отписаться»;
 * - владелец — «Новый поп», «Подписчики».
 */
export function channelInfoActions(
  role: ChannelRole,
  subscription: ChannelSubscription | null,
  handlers: ChannelInfoActionHandlers,
): InfoAction[] {
  const unsubscribe: InfoAction = {
    id: 'unsubscribe',
    label: 'Отписаться',
    icon: UNSUBSCRIBE_ICON,
    onPress: handlers.onUnsubscribe,
  };

  switch (role) {
    case 'owner':
      return [
        {
          id: 'new-pop',
          label: 'Новый поп',
          icon: { ios: 'plus.app', android: 'add_box', web: 'add_box' },
          onPress: handlers.onNewPop,
        },
        {
          id: 'subscribers',
          label: 'Подписчики',
          icon: { ios: 'person.2', android: 'group', web: 'group' },
          onPress: handlers.onSubscribers,
        },
      ];
    case 'subscriber':
      return [
        {
          id: 'add-to-chats',
          label: 'Добавить в чаты',
          icon: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' },
          onPress: () => handlers.onSetInChats(true),
        },
        unsubscribe,
      ];
    case 'reader': {
      const muted = subscription?.notify === false;

      return [
        {
          id: 'mute',
          label: muted ? 'Включить звук' : 'Без звука',
          icon: muted
            ? { ios: 'bell', android: 'notifications', web: 'notifications' }
            : { ios: 'bell.slash', android: 'notifications_off', web: 'notifications_off' },
          onPress: () => handlers.onSetNotify(muted),
        },
        {
          id: 'hide',
          label: 'Убрать из чатов',
          icon: {
            ios: 'tray.and.arrow.up',
            android: 'remove_circle_outline',
            web: 'remove_circle_outline',
          },
          onPress: () => handlers.onSetInChats(false),
        },
        unsubscribe,
      ];
    }
    default:
      return [];
  }
}
