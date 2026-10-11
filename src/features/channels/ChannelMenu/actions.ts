import type { MenuAction } from '@/components/MenuList';
import type { ChannelSubscription } from '@/api/subscriptions';
import type { SubscriptionStatus } from '@/features/channels/useChannelSubscription';

export type ChannelMenuItem = 'subscribers' | 'mute' | 'unmute' | 'hide' | 'add' | 'unsubscribe';

const UNSUBSCRIBE: MenuAction<ChannelMenuItem> = {
  id: 'unsubscribe',
  label: 'Отписаться',
  destructive: true,
};

/**
 * Пункты «⋮» канала по тому, кто я ему. Уведомления — только у читателя: без
 * чатов карточек и так нет.
 */
export function channelMenuActions(
  status: SubscriptionStatus,
  subscription: ChannelSubscription | null,
  isOwner: boolean,
): MenuAction<ChannelMenuItem>[] {
  if (isOwner) return [{ id: 'subscribers', label: 'Подписчики' }];

  if (status === 'reader') {
    return [
      subscription?.notify === false
        ? { id: 'unmute', label: 'Включить уведомления' }
        : { id: 'mute', label: 'Выключить уведомления' },
      { id: 'hide', label: 'Не отображать в чатах' },
      UNSUBSCRIBE,
    ];
  }

  if (status === 'subscriber') return [{ id: 'add', label: 'Добавить в чаты' }, UNSUBSCRIBE];

  return [];
}
