import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { ChatSummary } from '@/api/chats';
import { LoadFailed } from '@/components/LoadFailed';
import { PlainPageBar } from '@/components/PageBar';
import { SlidePage, useSlideBack } from '@/components/SlidePage';
import { ChatConversation } from '@/features/chats/ChatConversation';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing } from '@/lib/loadState';

/**
 * Экран чата. Чат постов канала сам по себе не открывается: куда бы ни вёл
 * маршрут по его id, он попадает на
 * экран канала с разделами.
 *
 * Чтобы переписка не успела мелькнуть и подписаться на чат, который окажется
 * каналом, вид чата узнаётся до неё: из списка чатов, если он там есть, иначе
 * — ожиданием самого чата.
 *
 * Экран — страница (`SlidePage`): въезжает справа и уезжает свайпом за
 * пальцем, под ней виден экран, откуда пришли. Открыли с холодного старта и
 * под ней пусто — назад ведёт в «Чаты».
 */
export function ChatScreen({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const listed = queryClient
    .getQueryData<ChatSummary[]>(chatsQueryKey)
    ?.find((chat) => chat.id === chatId);
  const { chat, isLoading, failed } = useChat(chatId);
  const known = chat ?? listed ?? null;
  const router = useRouter();
  const toChats = useCallback(() => router.replace('/chats'), [router]);
  const slide = useSlideBack(toChats);

  if (known?.channel) {
    return (
      <Redirect
        href={{
          pathname: '/chats/channel/[channelId]',
          params: { channelId: known.channel.id },
        }}
      />
    );
  }

  // Сбой показывает экран, а не переписка: смонтированная поверх
  // упавшего запроса, она перезапросила бы его (повтор при монтировании),
  // экран снова ушёл бы в крутилку и размонтировал её — и так по кругу.
  if (!known && failed) {
    return (
      <SlidePage slide={slide}>
        <PlainPageBar title="Чат" onBack={slide.close} />
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <LoadFailed
            message="Не удалось загрузить переписку"
            onRetry={() =>
              reloadMissing(queryClient, [chatQueryKey(chatId), messagesQueryKey(chatId)])
            }
          />
        </View>
      </SlidePage>
    );
  }

  if (!known && isLoading) {
    return (
      <SlidePage slide={slide}>
        <PlainPageBar title="Чат" onBack={slide.close} />
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.background }}>
          <ActivityIndicator accessibilityLabel="Загрузка переписки" />
        </View>
      </SlidePage>
    );
  }

  return (
    <SlidePage slide={slide}>
      <ChatConversation chatId={chatId} />
    </SlidePage>
  );
}
