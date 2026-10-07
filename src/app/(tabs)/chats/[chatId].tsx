import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import type { ChatSummary } from '@/api/chats';
import { ChatConversation } from '@/features/chats/ChatConversation';
import { useChat } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useTheme } from '@/hooks/use-theme';

/**
 * Экран чата. Чат постов канала сам по себе не открывается: куда бы ни вёл
 * переход по его id (заголовок островка, закреп, цитата), он попадает на
 * экран канала с разделами.
 *
 * Чтобы переписка не успела мелькнуть и подписаться на чат, который окажется
 * каналом, вид чата узнаётся до неё: из списка чатов, если он там есть, иначе
 * — ожиданием самого чата.
 */
export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const theme = useTheme();
  const listed = useQueryClient()
    .getQueryData<ChatSummary[]>(chatsQueryKey)
    ?.find((chat) => chat.id === chatId);
  const { chat, isLoading } = useChat(chatId);
  const known = chat ?? listed ?? null;

  if (known?.channel) return <Redirect href={`/chats/channel/${known.channel.id}`} />;

  if (!known && isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator accessibilityLabel="Загрузка переписки" />
      </View>
    );
  }

  return <ChatConversation chatId={chatId} />;
}
