import { SymbolView } from 'expo-symbols';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PopChannelPage } from './PopChannelPage';
import type { PopFeed } from './popFeed';
import { PopPager } from './PopPager';
import { styles } from './styles';
import { useAppActive } from './useAppActive';
import { useCommentsChromeFade } from './useCommentsShrink';
import type { OpenChannelMode } from './useOpenChannel';
import { usePopComments } from './usePopComments';
import { usePopJournal } from './usePopJournal';
import { usePopFeedPaging, usePopViewCounting } from './usePopViewerEffects';

import type { Pop } from '@/api/pops';
import { Text } from '@/components/Text';
import { CommentsPanel } from '@/features/interactions/CommentsPanel';
import { useCanPublishState } from '@/features/pops/queries';
import { usePopCountersSync } from '@/features/pops/usePopCountersSync';
import type { JournalSurface } from '@/features/recs/journal/journal';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';
import { Sizes } from '@/theme';

const popKey = (pop: Pop) => pop.id;

export type PopViewerProps = {
  /** Что листать: попсы канала или выдачу поиска. */
  feed: PopFeed;
  startId: string;
  /** Куда ведёт имя канала: под просмотр (лента канала) или поверх него (поиск). */
  channelLink?: OpenChannelMode;
  /** Сразу с открытыми комментариями к стартовому попу. */
  openComments?: boolean;
  /** Комментарий, к которому пришли: наверху шита и подсвечен. */
  focusCommentId?: string;
  /** Активной стала другая страница. */
  onActivePop?: (pop: Pop) => void;
  /** Где идёт показ — для журнала рекомендаций. */
  surface?: JournalSurface;
  /** Откуда открыли просмотр. */
  entry?: string;
};

/**
 * Просмотр попсов, как в TikTok: на весь экран, страница за страницей по
 * вертикали, от выбранного в обе стороны. Играет только активная страница;
 * следующая прогревает плеер, остальные — обложки.
 *
 * Лента приходит снаружи (`PopFeed`), а всё, что зависит от канала, берётся
 * по каналу попа: шапка и подписка — у каждой страницы своя
 * (`PopChannelPage`), право публиковать для комментариев и учёта просмотров —
 * по активной, живые счётчики — по каналам активной и соседних.
 */
export function PopViewer({
  feed,
  startId,
  channelLink = 'under',
  openComments = false,
  focusCommentId,
  onActivePop,
  surface = 'channel',
  entry = 'other',
}: PopViewerProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const appActive = useAppActive();
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
  const activeChannelId = pops[activeIndex]?.channelId ?? null;
  const {
    canPublish,
    known: rightsKnown,
    failed: rightsFailed,
  } = useCanPublishState(activeChannelId);
  const popsRef = useRef(pops);
  const activePop = pops[activeIndex];

  useEffect(() => {
    if (activePop) onActivePop?.(activePop);
    // Только смена страницы: обновление счётчиков того же попа — не повод.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePop?.id, onActivePop]);

  useEffect(() => {
    popsRef.current = pops;
  }, [pops]);

  const live = focused && appActive;
  const startReady = Boolean(size) && pops[activeIndex]?.id === startId;
  const start = useMemo(
    () => (openComments ? { startId, focusCommentId, ready: startReady, rightsKnown } : undefined),
    [focusCommentId, openComments, rightsKnown, startId, startReady],
  );
  const { openPopId, onOpenComments, onOpenPerson } = usePopComments(canPublish, start);
  const commentsOpen = openPopId !== null;
  const chromeStyle = useCommentsChromeFade(commentsOpen);
  const nearbyChannels = useMemo(
    () => pops.slice(Math.max(activeIndex - 1, 0), activeIndex + 2).map((pop) => pop.channelId),
    [activeIndex, pops],
  );

  usePopCountersSync(nearbyChannels);
  usePopViewCounting(
    pops,
    activeIndex,
    { canPublish, known: rightsKnown, failed: rightsFailed },
    focused,
  );
  usePopFeedPaging(feed, activeIndex);
  usePopJournal({ pops, activeIndex, focused, appActive, surface, entry });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setSize((current) =>
      current && current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const { channelOf } = feed;
  const renderPage = useCallback(
    (pop: Pop, index: number) => {
      if (!size) return null;

      return (
        <PopChannelPage
          pop={pop}
          face={channelOf?.(pop) ?? null}
          channelLink={channelLink}
          width={size.width}
          height={size.height}
          mode={index === activeIndex ? 'active' : index === activeIndex + 1 ? 'preload' : 'idle'}
          live={live}
          onOpenComments={onOpenComments}
          // Только страница этого попа: остальные не перерисовываются, а
          // соседняя, ставшая активной, пока поп пропадал из ленты, не уменьшается.
          commentsOpen={pop.id === openPopId}
        />
      );
    },
    [activeIndex, channelLink, channelOf, live, onOpenComments, openPopId, size],
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
      {pops.length > 0 ? (
        // Попсы уже есть, а экран ещё не измерен — пусто, а не «Поп удалён».
        size ? (
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
        ) : null
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
