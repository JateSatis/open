import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import type { ChatSummary } from '@/api/chats';
import { LoadFailed } from '@/components/LoadFailed';
import { ChatConversation } from '@/features/chats/ChatConversation';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing } from '@/lib/loadState';

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
  const queryClient = useQueryClient();
  const listed = queryClient
    .getQueryData<ChatSummary[]>(chatsQueryKey)
    ?.find((chat) => chat.id === chatId);
  const { chat, isLoading, failed } = useChat(chatId);
  const known = chat ?? listed ?? null;

  if (known?.channel) return <Redirect href={`/chats/channel/${known.channel.id}`} />;

  // Сбой показывает сам маршрут, а не переписка: смонтированная поверх
  // упавшего запроса, она перезапросила бы его (повтор при монтировании),
  // маршрут снова ушёл бы в крутилку и размонтировал её — и так по кругу.
  if (!known && failed) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <LoadFailed
          message="Не удалось загрузить переписку"
          onRetry={() =>
            reloadMissing(queryClient, [chatQueryKey(chatId), messagesQueryKey(chatId)])
          }
        />
      </View>
    );
  }

  if (!known && isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator accessibilityLabel="Загрузка переписки" />
      </View>
    );
  }

  return <ChatConversation chatId={chatId} />;
}
