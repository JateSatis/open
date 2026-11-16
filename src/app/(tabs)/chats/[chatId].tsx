import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/features/chats/ChatScreen';

export default function ChatRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  return <ChatScreen chatId={chatId} />;
}
