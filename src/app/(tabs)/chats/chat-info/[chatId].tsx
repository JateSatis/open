import { useLocalSearchParams } from 'expo-router';

import { ChatInfoScreen } from '@/features/chats/ChatInfoScreen';

export default function ChatInfoRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  return <ChatInfoScreen chatId={chatId} />;
}
