import { useNavigation, useRouter } from '@/navigation';
import { useCallback } from 'react';


const CLEARED_PARAMS = Object.fromEntries(
  ['search', 'searchKey', 'section'].map((name) => [name, undefined]),
);

/**
 * Со страницы канала — в поиск по его «Постам». Экран этого
 * канала прямо под страницей получает параметры и страница уходит к нему;
 * под страницей не он (открыли ссылкой) — канал открывается поверх. Только
 * экран прямо под страницей: такой же канал глубже в стеке получил бы
 * параметры, а вернулись бы не к нему.
 */
export function useToPosts(channelId: string, close: () => void) {
  const router = useRouter();
  const navigation = useNavigation();

  const toPosts = useCallback(
    (params: Record<string, string>) => {
      const state = navigation.getState();
      const below = state ? state.routes[state.index - 1] : undefined;

      if (
        below?.name === 'Channel' &&
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

      router.push({ name: 'Channel', params: { channelId, ...params } });
    },
    [channelId, close, navigation, router],
  );

  const searchPosts = useCallback(
    () => toPosts({ search: '1', searchKey: String(Date.now()) }),
    [toPosts],
  );

  return { searchPosts };
}
