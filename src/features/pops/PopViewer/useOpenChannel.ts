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
 * Тап по имени канала. Открыт из этого канала — назад к нему, а не новым
 * экраном поверх; иначе — экран канала. Просмотр — экран корневого стека
 * поверх вкладок, а канал открывается во вкладке чатов под ним, поэтому
 * просмотр в обоих случаях сначала закрывается.
 */
export function useOpenChannel(channelId: string): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState() as unknown as { index: number; routes: NavRoute[] };

    router.back();

    if (!channelScreenBelow(state, channelId)) router.push(`/chats/channel/${channelId}`);
  }, [channelId, navigation, router]);
}
