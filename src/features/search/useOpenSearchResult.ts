import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { addRecentSearch, type RecentSearch } from '@/features/search/recentSearches';
import { loadMessageWindow } from '@/features/chats/messages/useMessageWindow';
import { messageWindowKey } from '@/features/chats/messages/historyCache';

/**
 * Тап по строке выдачи или «Недавних»: открыть и запомнить. Чат — перепиской
 * (чужая группа — тоже, как у постороннего), канал — экраном канала,
 * человек — профилем. Сообщение — его чатом с прыжком к нему, пост — экраном
 * канала с прыжком в «Постах». Ключ перехода новый на каждый тап: к тому же
 * чату приходят и второй раз, к другому сообщению.
 */
export function useOpenSearchResult(): (item: RecentSearch) => void {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (item: RecentSearch) => {
      addRecentSearch(item);

      if (item.type === 'message') {
        const { message } = item;
        void queryClient.prefetchQuery({
          queryKey: messageWindowKey(message.chatId, message.seq),
          queryFn: () => loadMessageWindow(message.chatId, message.seq),
          staleTime: Infinity,
        });
        const jump = {
          jumpTo: message.id,
          jumpSeq: String(message.seq),
          jumpKey: String(Date.now()),
        };

        if (message.channelId) {
          router.push({
            pathname: '/chats/channel/[channelId]',
            params: { channelId: message.channelId, ...jump },
          });
        } else {
          router.push({
            pathname: '/chats/[chatId]',
            params: { chatId: message.chatId, ...jump, from: 'search' },
          });
        }
        return;
      }

      const { entity } = item;

      if (entity.kind === 'person') {
        router.push({ pathname: '/chats/people/[userId]', params: { userId: entity.id } });
      } else if (entity.kind === 'channel' && entity.channelId) {
        router.push({
          pathname: '/chats/channel/[channelId]',
          params: { channelId: entity.channelId },
        });
      } else if (entity.chatId) {
        router.push({
          pathname: '/chats/[chatId]',
          params: { chatId: entity.chatId, from: 'search' },
        });
      }
    },
    [queryClient, router],
  );
}
