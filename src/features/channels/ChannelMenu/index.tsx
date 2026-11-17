import { useRouter } from '@/navigation';

import { channelMenuActions, type ChannelMenuItem } from './actions';

import { HeaderMenu } from '@/components/HeaderMenu';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';

export type ChannelMenuProps = {
  channelId: string;
  /** Я создатель канала: мне — список подписчиков. */
  isOwner: boolean;
};

/**
 * «⋮» справа в шапке канала. Подписчику — уведомления, чаты и отписка,
 * создателю — «Подписчики». Постороннему и пока роль не известна — кнопки нет.
 */
export function ChannelMenu({ channelId, isOwner }: ChannelMenuProps) {
  const router = useRouter();
  const { status, subscription } = useChannelSubscription(channelId);
  const actions = useSubscriptionActions(channelId);

  const run = (item: ChannelMenuItem) => {
    switch (item) {
      case 'subscribers':
        router.push({ name: 'ChannelSubscribers', params: { channelId } });
        return;
      case 'mute':
        void actions.setNotify(false);
        return;
      case 'unmute':
        void actions.setNotify(true);
        return;
      case 'hide':
        void actions.setInChats(false);
        return;
      case 'add':
        void actions.setInChats(true);
        return;
      case 'unsubscribe':
        void actions.unsubscribe();
        return;
    }
  };

  return (
    <HeaderMenu
      testID="channel-menu"
      accessibilityLabel="Меню канала"
      actions={channelMenuActions(status, subscription, isOwner)}
      onSelect={run}
    />
  );
}
