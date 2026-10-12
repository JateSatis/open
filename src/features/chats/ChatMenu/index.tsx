import { useRouter } from 'expo-router';

import { chatMenuActions, type ChatMenuItem } from './actions';

import type { Subscription } from '@/api/subscriptions';
import { HeaderMenu } from '@/components/HeaderMenu';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';

export type ChatMenuProps = {
  chatId: string;
  isMember: boolean;
  /** Моя подписка на чат; `undefined` — ещё не известна. */
  subscription: Subscription | null | undefined;
};

/** «⋮» справа в шапке диалога или группы: подписчикам — уведомления и отписка, участнику — список подписчиков. */
export function ChatMenu({ chatId, isMember, subscription }: ChatMenuProps) {
  const router = useRouter();
  const actions = useChatSubscriptionActions(chatId);

  const run = (item: ChatMenuItem) => {
    switch (item) {
      case 'subscribers':
        router.push({ pathname: '/chats/chat-subscribers/[chatId]', params: { chatId } });
        return;
      case 'mute':
        void actions.setNotify(false);
        return;
      case 'unmute':
        void actions.setNotify(true);
        return;
      case 'unsubscribe':
        void actions.unsubscribe();
        return;
    }
  };

  return (
    <HeaderMenu
      testID="chat-menu"
      accessibilityLabel="Меню чата"
      actions={chatMenuActions(isMember, subscription)}
      onSelect={run}
    />
  );
}
