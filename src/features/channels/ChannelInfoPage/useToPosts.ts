import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { JUMP_PARAM_NAMES } from '@/features/chats/jumpParams';
import { channelQueryKey } from '@/features/channels/keys';
import type { Channel } from '@/api/channels';
import { loadMessageWindow } from '@/features/chats/messages/useMessageWindow';
import { messageWindowKey } from '@/features/chats/messages/historyCache';

const CLEARED_PARAMS = Object.fromEntries(
  [...JUMP_PARAM_NAMES, 'search', 'searchKey', 'section'].map((name) => [name, undefined]),
);

/**
 * Со страницы канала — в его «Посты»: к посту или в поиск. Экран этого
 * канала прямо под страницей получает параметры и страница уходит к нему;
 * под страницей не он (открыли ссылкой) — канал открывается поверх. Только
 * экран прямо под страницей: такой же канал глубже в стеке получил бы
 * параметры, а вернулись бы не к нему.
 */
export function useToPosts(channelId: string, close: () => void) {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const toPosts = useCallback(
    (params: Record<string, string>) => {
      const state = navigation.getState();
      const below = state ? state.routes[state.index - 1] : undefined;

      if (
        below?.name === 'channel/[channelId]' &&
        (below.params as { channelId?: string } | undefined)?.channelId === channelId
      ) {
        navigation.dispatch({
          type: 'SET_PARAMS',
          payload: { params: { ...CLEARED_PARAMS, channelId, ...params } },
          source: below.key,
        });
        close();
        return;
      }

      router.push({ pathname: '/chats/channel/[channelId]', params: { channelId, ...params } });
    },
    [channelId, close, navigation, router],
  );

  const showInChat = useCallback(
    (messageId: string, seq: number) => {
      const chatId = queryClient.getQueryData<Channel>(channelQueryKey(channelId))?.postsChatId;
      if (chatId) void queryClient.prefetchQuery({
        queryKey: messageWindowKey(chatId, seq),
        queryFn: () => loadMessageWindow(chatId, seq),
        staleTime: Infinity,
      });
      toPosts({ jumpTo: messageId, jumpSeq: String(seq), jumpKey: String(Date.now()) });
    },
    [channelId, queryClient, toPosts],
  );
  const searchPosts = useCallback(
    () => toPosts({ search: '1', searchKey: String(Date.now()) }),
    [toPosts],
  );

  return { showInChat, searchPosts };
}
