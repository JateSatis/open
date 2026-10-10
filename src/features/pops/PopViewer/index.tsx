import { useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HEART } from './HeartBurst';
import { PopPage, type PopPageMode } from './PopPage';
import { PopPager } from './PopPager';
import { styles } from './styles';

import { recordPopViews, type Pop } from '@/api/pops';
import { Text } from '@/components/Text';
import { useChannel } from '@/features/channels/useChannel';
import { readPendingReaction } from '@/features/interactions/pendingReactions';
import { sendReaction } from '@/features/interactions/reactionSender';
import { audienceOf } from '@/features/interactions/reactionState';
import { doubleTapReaction, withPendingPopReaction } from '@/features/pops/popReactions';
import { useCanPublish } from '@/features/pops/queries';
import { usePopCountersSync } from '@/features/pops/usePopCountersSync';
import { usePopFeed } from '@/features/pops/usePopFeed';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';
import { useViewBatcher } from '@/lib/useViewBatcher';
import { Sizes } from '@/theme';

const popKey = (pop: Pop) => pop.id;

/** Ближе этого к краю загруженного — подгружаем следующую страницу. */
const PREFETCH_PAGES = 3;

export type PopViewerProps = { channelId: string; startId: string };

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

/** Под просмотром — экран этого же канала: к нему — назад, а не новым экраном поверх. */
function channelScreenBelow(state: { index: number; routes: NavRoute[] }, channelId: string) {
  const below = state.routes[state.index - 1];

  if (!below) return false;

  const leaf = visibleLeaf(below);
  const params = leaf.params as { channelId?: unknown } | undefined;

  return leaf.name === 'channel/[channelId]' && params?.channelId === channelId;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );

    return () => subscription.remove();
  }, []);

  return active;
}

/**
 * Просмотр попсов канала, как в TikTok: на весь экран, страница за страницей
 * по вертикали, от выбранного — выше новее, ниже старше. Играет только
 * активная страница; следующая прогревает плеер, остальные — обложки.
 */
export function PopViewer({ channelId, startId }: PopViewerProps) {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const canPublish = useCanPublish(channelId);
  const channel = useChannel(channelId);
  const feed = usePopFeed(channelId, startId);
  const { pops, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage } = feed;
  const { fetchNextPage, fetchPreviousPage } = feed;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [activeId, setActiveId] = useState(startId);

  usePopCountersSync(channelId);

  const activeIndex = Math.max(
    0,
    pops.findIndex((pop) => pop.id === activeId),
  );

  const live = focused && appActive;

  // Просмотр — сразу при показе: поп стал активной страницей. Свои — не считаются.
  const sendViews = useCallback(
    (items: { id: string }[], sessionId: string) =>
      recordPopViews(
        items.map(({ id }) => id),
        sessionId,
      ),
    [],
  );
  const views = useViewBatcher({ isFocused: focused, send: sendViews, repeat: 'appearance' });
  const { setVisible } = views;

  useEffect(() => {
    if (canPublish || pops.length === 0) return;

    setVisible([{ id: pops[activeIndex].id }]);
  }, [activeIndex, canPublish, pops, setVisible]);

  useEffect(() => {
    if (activeIndex >= pops.length - PREFETCH_PAGES && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }

    if (activeIndex < PREFETCH_PAGES && hasPreviousPage && !isFetchingPreviousPage) {
      void fetchPreviousPage();
    }
  }, [
    activeIndex,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    pops.length,
  ]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setSize((current) =>
      current && current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const audience = audienceOf(canPublish);

  const onReaction = useCallback(
    (pop: Pop, emoji: string | null) =>
      sendReaction(queryClient, pop.id, { emoji, audience }, 'pop'),
    [audience, queryClient],
  );

  const onDoubleTap = useCallback(
    (pop: Pop) => {
      const shown = withPendingPopReaction(pop.reactions, readPendingReaction(pop.id));
      const emoji = doubleTapReaction(shown, HEART);

      if (emoji) sendReaction(queryClient, pop.id, { emoji, audience }, 'pop');
    },
    [audience, queryClient],
  );

  const onOpenChannel = useCallback(() => {
    const state = navigation.getState() as unknown as { index: number; routes: NavRoute[] };

    if (channelScreenBelow(state, channelId)) router.back();
    else router.push(`/chats/channel/${channelId}`);
  }, [channelId, navigation, router]);

  const channelTitle = channel.data?.title ?? null;

  const renderPage = useCallback(
    (pop: Pop, index: number) => {
      if (!size) return null;

      const mode: PopPageMode =
        index === activeIndex ? 'active' : index === activeIndex + 1 ? 'preload' : 'idle';

      return (
        <PopPage
          pop={pop}
          channelTitle={channelTitle}
          width={size.width}
          height={size.height}
          mode={mode}
          live={live}
          onReaction={onReaction}
          onDoubleTap={onDoubleTap}
          onOpenChannel={onOpenChannel}
        />
      );
    },
    [activeIndex, channelTitle, live, onDoubleTap, onOpenChannel, onReaction, size],
  );

  const onActiveIndex = useCallback(
    (index: number) => {
      const pop = pops[index];

      if (pop) setActiveId(pop.id);
    },
    [pops],
  );

  const loadError = describeLoadError(feed.error, 'Не удалось загрузить попсы');

  return (
    <View
      testID="pop-viewer"
      style={[styles.root, { backgroundColor: theme.viewerBackground }]}
      onLayout={onLayout}
    >
      {size && pops.length > 0 ? (
        <PopPager
          items={pops}
          activeIndex={activeIndex}
          width={size.width}
          height={size.height}
          onActiveIndex={onActiveIndex}
          keyOf={popKey}
          renderPage={renderPage}
        />
      ) : (
        <View style={styles.message}>
          {feed.isPending ? (
            <ActivityIndicator color={theme.textOnMedia} accessibilityLabel="Загрузка попа" />
          ) : (
            <Text color="textOnMedia">{loadError ?? 'Поп удалён'}</Text>
          )}
        </View>
      )}

      <Pressable
        testID="pop-viewer-back"
        accessibilityRole="button"
        accessibilityLabel="Назад"
        onPress={() => router.back()}
        style={[styles.back, styles.onMediaShadow, { top: insets.top, shadowColor: theme.shadow }]}
      >
        <SymbolView
          name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          size={Sizes.popBackIcon}
          tintColor={theme.textOnMedia}
        />
      </Pressable>
    </View>
  );
}
