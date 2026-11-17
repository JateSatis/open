import { useRouteParams } from '@/navigation';

import { SubscribersScreen } from '@/features/channels/SubscribersScreen';

export function ChatSubscribersRoute() {
  const { chatId } = useRouteParams<'ChatSubscribers'>();

  return <SubscribersScreen target={{ kind: 'chat', id: chatId }} />;
}
