import { SymbolView } from 'expo-symbols';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PopPage, type PopPageMode } from './PopPage';
import { PopPager } from './PopPager';
import { styles } from './styles';
import { useAppActive } from './useAppActive';
import { useCommentsChromeFade } from './useCommentsShrink';
import { useOpenChannel } from './useOpenChannel';
import { usePopComments } from './usePopComments';
import { usePopReactionActions } from './usePopReactionActions';
import { usePopFeedPaging, usePopViewCounting } from './usePopViewerEffects';

import type { Pop } from '@/api/pops';
import { Text } from '@/components/Text';
import { useChannel } from '@/features/channels/useChannel';
import { CommentsPanel } from '@/features/interactions/CommentsPanel';
import { useCanPublish } from '@/features/pops/queries';
import { usePopCountersSync } from '@/features/pops/usePopCountersSync';
import { usePopFeed } from '@/features/pops/usePopFeed';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';
import { Sizes } from '@/theme';

const popKey = (pop: Pop) => pop.id;

export type PopViewerProps = { channelId: string; startId: string };

/**
 * Просмотр попсов канала, как в TikTok: на весь экран, страница за страницей
 * по вертикали, от выбранного — выше новее, ниже старше. Играет только
 * активная страница; следующая прогревает плеер, остальные — обложки.
 */
export function PopViewer({ channelId, startId }: PopViewerProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const canPublish = useCanPublish(channelId);
  const channel = useChannel(channelId);
  const feed = usePopFeed(channelId, startId);
  const { pops } = feed;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Активный поп и его последнее место в ленте. Пропал из ленты (удалён,
  // лента перечитана) — экран остаётся на том же месте, на соседнем попе.
  const [active, setActive] = useState({ id: startId, at: 0 });
  const found = pops.findIndex((pop) => pop.id === active.id);

  if (found >= 0 && found !== active.at) setActive({ id: active.id, at: found });

  if (found < 0 && pops.length > 0) {
    const at = Math.min(active.at, pops.length - 1);

    // Стартовый ещё не загружен — ждём его, а не перескакиваем на соседа.
    if (active.id !== startId || !feed.isFetching) setActive({ id: pops[at].id, at });
  }

  const activeIndex = found >= 0 ? found : Math.min(active.at, Math.max(pops.length - 1, 0));
  const popsRef = useRef(pops);

  useEffect(() => {
    popsRef.current = pops;
  }, [pops]);

  const live = focused && appActive;
  const { onReaction, onDoubleTap } = usePopReactionActions(canPublish);
  const onOpenChannel = useOpenChannel(channelId);
  const { openPopId, onOpenComments, onOpenPerson } = usePopComments(canPublish);
  const commentsOpen = openPopId !== null;
  const chromeStyle = useCommentsChromeFade(commentsOpen);

  usePopCountersSync(channelId);
  usePopViewCounting(pops, activeIndex, canPublish, focused);
  usePopFeedPaging(feed, activeIndex);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setSize((current) =>
      current && current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

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
          onOpenComments={onOpenComments}
          // Только страница этого попа: остальные не перерисовываются, а
          // соседняя, ставшая активной, пока поп пропадал из ленты, не уменьшается.
          commentsOpen={pop.id === openPopId}
        />
      );
    },
    [
      activeIndex,
      channelTitle,
      live,
      onDoubleTap,
      onOpenChannel,
      onOpenComments,
      onReaction,
      openPopId,
      size,
    ],
  );

  // Стабильный: от него зависит жест листания, и обновления счётчиков не
  // должны пересоздавать жест посреди свайпа.
  const onActiveIndex = useCallback((index: number) => {
    const pop = popsRef.current[index];

    if (pop) setActive({ id: pop.id, at: index });
  }, []);

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
          locked={commentsOpen}
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

      <Animated.View
        style={[styles.back, { top: insets.top }, chromeStyle]}
        pointerEvents={commentsOpen ? 'none' : 'auto'}
      >
        <Pressable
          testID="pop-viewer-back"
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={() => router.back()}
          style={[styles.backButton, styles.onMediaShadow, { shadowColor: theme.shadow }]}
        >
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={Sizes.popBackIcon}
            tintColor={theme.textOnMedia}
          />
        </Pressable>
      </Animated.View>

      <CommentsPanel onOpenPerson={onOpenPerson} />
    </View>
  );
}
