import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { sectionRequestParams } from '@/features/channels/sectionRequest';

/** Маршрут в состоянии навигатора — столько, сколько нужно, чтобы дойти до видимого экрана. */
type NavRoute = {
  key: string;
  name: string;
  params?: object;
  state?: { key?: string; index?: number; routes: NavRoute[] };
};

type NavState = { key?: string; index: number; routes: NavRoute[] };

/**
 * Видимый экран внутри маршрута — с учётом вложенных навигаторов (вкладки,
 * стек чатов) — и ключ навигатора, в котором он лежит (`undefined` — тот же,
 * что у самого маршрута).
 */
function visibleLeaf(route: NavRoute): { leaf: NavRoute; navigatorKey?: string } {
  let leaf = route;
  let navigatorKey: string | undefined;

  while (leaf.state && leaf.state.routes.length > 0) {
    navigatorKey = leaf.state.key;
    leaf = leaf.state.routes[leaf.state.index ?? leaf.state.routes.length - 1];
  }

  return { leaf, navigatorKey };
}

/** Экран этого же канала под просмотром — или `null`. */
function channelScreenBelow(state: NavState, channelId: string) {
  const below = state.routes[state.index - 1];

  if (!below) return null;

  const found = visibleLeaf(below);
  const params = found.leaf.params as { channelId?: unknown } | undefined;

  return found.leaf.name.endsWith('channel/[channelId]') && params?.channelId === channelId
    ? found
    : null;
}

/**
 * Куда ведёт имя канала. `under` — просмотр попсов канала: канал открывается
 * во вкладке чатов под просмотром, и просмотр закрывается. `over` — просмотр
 * выдачи поиска: канал встаёт поверх просмотра экраном корневого стека, и
 * «назад» возвращает к тому же попу.
 */
export type OpenChannelMode = 'under' | 'over';

/**
 * Тап по имени канала: канал всегда открывается на «Попсах» — человек пришёл
 * из попса. Открыт из этого канала — назад к нему, а не новым экраном поверх,
 * и он переключается на «Попсы» запросом раздела; иначе — экран канала.
 * Просмотр — экран корневого стека поверх вкладок, а канал (`under`)
 * открывается во вкладке чатов под ним, поэтому просмотр в обоих случаях
 * сначала закрывается. Отсюда же канал будет открывать и лента.
 */
export function useOpenChannel(channelId: string, mode: OpenChannelMode = 'under'): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState() as unknown as NavState;
    const below = channelScreenBelow(state, channelId);

    if (below) {
      // Экран под просмотром мог остаться на «Постах»: просим «Попсы» его
      // параметрами. Он во вложенном стеке — действие адресуется тому стеку.
      navigation.dispatch({
        type: 'SET_PARAMS',
        payload: { params: sectionRequestParams('pops') },
        source: below.leaf.key,
        ...(below.navigatorKey ? { target: below.navigatorKey } : {}),
      });
      router.back();
      return;
    }

    const params = { channelId, section: 'pops' };

    if (mode === 'over') {
      router.push({ pathname: '/channel/[channelId]', params });
      return;
    }

    router.back();
    router.push({ pathname: '/chats/channel/[channelId]', params });
  }, [channelId, mode, navigation, router]);
}
