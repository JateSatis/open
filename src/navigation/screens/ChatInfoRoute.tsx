import { useRouteParams } from '@/navigation';

import { ChatInfoScreen } from '@/features/chats/ChatInfoScreen';

export function ChatInfoRoute() {
  const { chatId } = useRouteParams<'ChatInfo'>();

  return <ChatInfoScreen chatId={chatId} />;
}
