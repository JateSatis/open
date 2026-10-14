import { useLocalSearchParams } from 'expo-router';

import { ChatInviteScreen } from '@/features/chats/ChatInviteScreen';

export default function ChatInviteRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  return <ChatInviteScreen chatId={chatId} />;
}
