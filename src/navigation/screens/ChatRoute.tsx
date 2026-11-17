import { useRouteParams } from '@/navigation';

import { ChatScreen } from '@/features/chats/ChatScreen';

export function ChatRoute() {
  const { chatId } = useRouteParams<'Chat'>();
  return <ChatScreen chatId={chatId} />;
}
