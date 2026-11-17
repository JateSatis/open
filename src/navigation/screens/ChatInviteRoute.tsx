import { useRouteParams } from '@/navigation';

import { ChatInviteScreen } from '@/features/chats/ChatInviteScreen';

export function ChatInviteRoute() {
  const { chatId } = useRouteParams<'ChatInvite'>();

  return <ChatInviteScreen chatId={chatId} />;
}
