import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeartBurst } from './HeartBurst';
import { PopCaption, type PopSubscribeAction } from './PopCaption';
import { PopProgressBar } from './PopProgressBar';
import { PopReactionPopover } from './PopReactionPopover';
import { PopSideColumn } from './PopSideColumn';
import { PopVideo } from './PopVideo';
import { PlaybackBadges } from './PlaybackBadges';
import { styles } from './styles';
import { usePageControls } from './usePageControls';
import { useCommentsChromeFade, useCommentsShrink } from './useCommentsShrink';
import { useSurfacePress } from './useSurfacePress';

import type { Pop } from '@/api/pops';
import { usePendingReactions } from '@/features/interactions/pendingReactions';
import { PopCover } from '@/features/pops/PopCover';
import { withPendingPopReaction } from '@/features/pops/popReactions';
import { currentPopImpression, registerControlProbe } from '@/features/recs/journal/popJournal';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Что делает страница: играет, прогревает плеер следом за активной или показывает обложку. */
export type PopPageMode = 'active' | 'preload' | 'idle';

export type PopPageProps = {
  pop: Pop;
  channelTitle: string | null;
  channelAvatarUrl: string | null;
  subscribe: PopSubscribeAction | null;
  width: number;
  height: number;
  mode: PopPageMode;
  /** Экран наверху и приложение не в фоне — можно играть. */
  live: boolean;
  onReaction: (pop: Pop, emoji: string | null) => void;
  onDoubleTap: (pop: Pop) => void;
  onOpenChannel: () => void;
  onOpenComments: (pop: Pop) => void;
  /**
   * Открыты комментарии к этому попу: видео уменьшено над шитом, интерфейс и
   * жесты по видео выключены. Касается только активной страницы.
   */
  commentsOpen: boolean;
};

export const PopPage = memo(function PopPage({
  pop,
  channelTitle,
  channelAvatarUrl,
  subscribe,
  width,
  height,
  mode,
  live,
  onReaction,
  onDoubleTap,
  onOpenChannel,
  onOpenComments,
  commentsOpen,
}: PopPageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const active = mode === 'active';
  const shrunk = active && commentsOpen;
  const videoStyle = useCommentsShrink(height, shrunk);
  const chromeStyle = useCommentsChromeFade(shrunk);
  const [scrubbingNow, setScrubbingNow] = useState(false);
  const controls = usePageControls(active);
  const { paused, fast, captionOpen, setCaptionOpen, picker, setPicker, framed, hearts } = controls;
  const progress = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const seekRef = useRef<((share: number) => void) | null>(null);

  const pending = usePendingReactions((state) => state.byMessage[pop.id]);
  const reactions = withPendingPopReaction(pop.reactions, pending);

  const { addHeart } = controls;
  const doubleTap = useCallback(
    (x: number, y: number) => {
      addHeart(x, y);
      onDoubleTap(pop);
    },
    [addHeart, onDoubleTap, pop],
  );

  const surfacePress = useSurfacePress({
    onTap: controls.togglePause,
    onDoubleTap: doubleTap,
    onHold: controls.setFast,
    enabled: active && !commentsOpen,
  });

  const openComments = useCallback(() => onOpenComments(pop), [onOpenComments, pop]);

  // Журнал показа: пауза тапом и 2× — воля человека, а не состояние плеера.
  // Показ, начавшийся на уже стоящем на паузе видео, спросит их сам.
  const controlsRef = useRef({ paused, fast });

  useEffect(() => {
    controlsRef.current = { paused, fast };
  }, [fast, paused]);

  useEffect(() => registerControlProbe(pop.id, () => controlsRef.current), [pop.id]);

  useEffect(() => {
    if (active) currentPopImpression(pop.id)?.setPaused(paused, 'tap');
  }, [active, paused, pop.id]);

  useEffect(() => {
    if (active) currentPopImpression(pop.id)?.setRate(fast ? 2 : 1);
  }, [active, fast, pop.id]);

  // Перемотка ползунком: откуда, куда, сколько пальцем прошло.
  const scrubShare = useRef<number | null>(null);
  const seek = useCallback(
    (share: number) => {
      const impression = currentPopImpression(pop.id);

      if (impression && scrubShare.current === null) impression.scrubStart();

      scrubShare.current = share;
      impression?.scrubMove(share * pop.durationMs);
      seekRef.current?.(share);
    },
    [pop.durationMs, pop.id],
  );
  const scrubChange = useCallback(
    (scrubbingOn: boolean) => {
      if (!scrubbingOn && scrubShare.current !== null) {
        currentPopImpression(pop.id)?.scrubEnd(scrubShare.current * pop.durationMs);
        scrubShare.current = null;
      }

      setScrubbingNow(scrubbingOn);
    },
    [pop.durationMs, pop.id],
  );
  const react = useCallback((emoji: string | null) => onReaction(pop, emoji), [onReaction, pop]);
  const tapReaction = useCallback(
    (emoji: string) => react(reactions.mine === emoji ? null : emoji),
    [react, reactions.mine],
  );

  const overlaysHidden = scrubbingNow;
  const playing = active && live && !paused && !scrubbingNow;

  return (
    <View testID={active ? 'pop-page-active' : 'pop-page'} style={[styles.page, { width, height }]}>
      <Animated.View
        testID={shrunk ? 'pop-video-shrunk' : undefined}
        style={[styles.videoLayer, videoStyle]}
        pointerEvents="none"
      >
        {mode !== 'idle' ? (
          <PopVideo
            pop={pop}
            playing={playing}
            fast={fast && active}
            progress={progress}
            scrubbing={scrubbing}
            seekRef={seekRef}
            onPlaying={controls.showFrame}
          />
        ) : null}
        {framed && active ? null : (
          <PopCover posterUri={pop.posterUrl} showLabel={false} recyclingKey={pop.id} />
        )}
      </Animated.View>

      <Pressable
        testID="pop-surface"
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Воспроизвести' : 'Пауза'}
        style={styles.surface}
        {...surfacePress}
      />

      <PlaybackBadges paused={paused && active} fast={fast && active} />

      {hearts.map((heart) => (
        <HeartBurst key={heart.key} heart={heart} onDone={controls.dropHeart} />
      ))}

      {captionOpen ? (
        <Pressable
          testID="pop-caption-scrim"
          accessibilityLabel="Свернуть подпись"
          onPress={() => setCaptionOpen(false)}
          style={[styles.scrim, { backgroundColor: theme.mediaScrim }]}
        />
      ) : null}

      {overlaysHidden ? null : (
        <Animated.View
          style={[styles.bottom, { paddingBottom: insets.bottom }, chromeStyle]}
          pointerEvents={shrunk ? 'none' : 'box-none'}
        >
          <PopCaption
            channelTitle={channelTitle}
            channelAvatarUrl={channelAvatarUrl}
            subscribe={subscribe}
            title={pop.title}
            caption={pop.caption}
            expanded={captionOpen}
            onToggle={() => setCaptionOpen((open) => !open)}
            onOpenChannel={onOpenChannel}
          />
          <PopSideColumn
            reactions={reactions}
            viewsCount={pop.viewsCount}
            commentsCount={pop.commentsCount}
            onReaction={tapReaction}
            onAddReaction={setPicker}
            onOpenComments={openComments}
          />
        </Animated.View>
      )}

      <Animated.View
        style={[styles.progressDock, { bottom: insets.bottom }, chromeStyle]}
        pointerEvents={shrunk ? 'none' : 'box-none'}
      >
        <PopProgressBar
          width={width}
          durationMs={pop.durationMs}
          progress={progress}
          scrubbing={scrubbing}
          onSeek={seek}
          onScrubChange={scrubChange}
        />
      </Animated.View>

      {picker ? (
        <PopReactionPopover
          reactions={reactions}
          width={width}
          height={height}
          anchor={picker}
          columnBottom={Sizes.popProgressTouch + insets.bottom}
          onSelect={(emoji) => {
            setPicker(null);
            react(reactions.mine === emoji ? null : emoji);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </View>
  );
});
