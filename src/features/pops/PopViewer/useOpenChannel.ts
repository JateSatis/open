import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';

/** Маршрут в состоянии навигатора — столько, сколько нужно, чтобы дойти до видимого экрана. */
type NavRoute = {
  name: string;
  params?: object;
  state?: { index?: number; routes: NavRoute[] };
};

/** Видимый экран внутри маршрута — с учётом вложенных навигаторов (вкладки, стек чатов). */
function visibleLeaf(route: NavRoute): NavRoute {
  let leaf = route;

  while (leaf.state && leaf.state.routes.length > 0) {
    leaf = leaf.state.routes[leaf.state.index ?? leaf.state.routes.length - 1];
  }

  return leaf;
}

/** Под просмотром — экран этого же канала. */
function channelScreenBelow(state: { index: number; routes: NavRoute[] }, channelId: string) {
  const below = state.routes[state.index - 1];

  if (!below) return false;

  const leaf = visibleLeaf(below);
  const params = leaf.params as { channelId?: unknown } | undefined;

  return leaf.name === 'channel/[channelId]' && params?.channelId === channelId;
}

/**
 * Куда ведёт имя канала. `under` — просмотр попсов канала: канал открывается
 * во вкладке чатов под просмотром, и просмотр закрывается. `over` — просмотр
 * выдачи поиска: канал встаёт поверх просмотра экраном корневого стека, и
 * «назад» возвращает к тому же попу.
 */
export type OpenChannelMode = 'under' | 'over';

/**
 * Тап по имени канала. Открыт из этого канала — назад к нему, а не новым
 * экраном поверх; иначе — экран канала. Просмотр — экран корневого стека
 * поверх вкладок, а канал (`under`) открывается во вкладке чатов под ним,
 * поэтому просмотр в обоих случаях сначала закрывается.
 */
export function useOpenChannel(channelId: string, mode: OpenChannelMode = 'under'): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState() as unknown as { index: number; routes: NavRoute[] };

    if (mode === 'over') {
      if (channelScreenBelow(state, channelId)) router.back();
      else router.push({ pathname: '/channel/[channelId]', params: { channelId } });
      return;
    }

    router.back();

    if (!channelScreenBelow(state, channelId)) router.push(`/chats/channel/${channelId}`);
  }, [channelId, mode, navigation, router]);
}
