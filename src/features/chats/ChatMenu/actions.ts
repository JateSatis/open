import type { MenuAction } from '@/components/MenuList';
import type { Subscription } from '@/api/subscriptions';

export type ChatMenuItem = 'subscribers' | 'mute' | 'unmute' | 'unsubscribe';

/**
 * Пункты «⋮» чата по тому, кто я ему: участнику — «Подписчики», подписчику —
 * уведомления и отписка, постороннему без подписки и пока не известно — ничего.
 */
export function chatMenuActions(
  isMember: boolean,
  subscription: Subscription | null | undefined,
): MenuAction<ChatMenuItem>[] {
  if (isMember) return [{ id: 'subscribers', label: 'Подписчики' }];
  if (!subscription) return [];

  return [
    subscription.notify
      ? { id: 'mute', label: 'Выключить уведомления' }
      : { id: 'unmute', label: 'Включить уведомления' },
    { id: 'unsubscribe', label: 'Отписаться', destructive: true },
  ];
}
