import { Redirect, useLocalSearchParams } from 'expo-router';

import { ChatConversation } from '@/features/chats/ChatConversation';
import { useChat } from '@/features/chats/useChat';

/**
 * Экран чата. Чат постов канала сам по себе не открывается: куда бы ни вёл
 * переход по его id (заголовок островка, закреп, цитата), он попадает на
 * экран канала с разделами.
 */
export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { chat } = useChat(chatId);

  if (chat?.channel) return <Redirect href={`/chats/channel/${chat.channel.id}`} />;

  return <ChatConversation chatId={chatId} />;
}
