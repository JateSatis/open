import { useLocalSearchParams } from 'expo-router';

import { ChatEditScreen } from '@/features/chats/ChatEditScreen';

export default function ChatEditRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  return <ChatEditScreen chatId={chatId} />;
}
