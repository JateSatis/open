import { useRouteParams } from '@/navigation';

import { ChatEditScreen } from '@/features/chats/ChatEditScreen';

export function ChatEditRoute() {
  const { chatId } = useRouteParams<'ChatEdit'>();

  return <ChatEditScreen chatId={chatId} />;
}
