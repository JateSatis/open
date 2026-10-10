import { memo, useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeartBurst } from './HeartBurst';
import { PopCaption } from './PopCaption';
import { PopProgressBar } from './PopProgressBar';
import { PopReactionPopover } from './PopReactionPopover';
import { PopSideColumn } from './PopSideColumn';
import { PopVideo } from './PopVideo';
import { PlaybackBadges } from './PlaybackBadges';
import { styles } from './styles';
import { usePageControls } from './usePageControls';
import { useSurfacePress } from './useSurfacePress';

import type { Pop } from '@/api/pops';
import { usePendingReactions } from '@/features/interactions/pendingReactions';
import { PopCover } from '@/features/pops/PopCover';
import { withPendingPopReaction } from '@/features/pops/popReactions';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Что делает страница: играет, прогревает плеер следом за активной или показывает обложку. */
export type PopPageMode = 'active' | 'preload' | 'idle';

export type PopPageProps = {
  pop: Pop;
  channelTitle: string | null;
  width: number;
  height: number;
  mode: PopPageMode;
  /** Экран наверху и приложение не в фоне — можно играть. */
  live: boolean;
  onReaction: (pop: Pop, emoji: string | null) => void;
  onDoubleTap: (pop: Pop) => void;
  onOpenChannel: () => void;
};

export const PopPage = memo(function PopPage({
  pop,
  channelTitle,
  width,
  height,
  mode,
  live,
  onReaction,
  onDoubleTap,
  onOpenChannel,
}: PopPageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const active = mode === 'active';
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
    enabled: active,
  });

  const seek = useCallback((share: number) => seekRef.current?.(share), []);
  const react = useCallback((emoji: string | null) => onReaction(pop, emoji), [onReaction, pop]);
  const tapReaction = useCallback(
    (emoji: string) => react(reactions.mine === emoji ? null : emoji),
    [react, reactions.mine],
  );

  const overlaysHidden = scrubbingNow;
  const playing = active && live && !paused && !scrubbingNow;

  return (
    <View testID={active ? 'pop-page-active' : 'pop-page'} style={[styles.page, { width, height }]}>
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
        <View style={[styles.bottom, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <PopCaption
            channelTitle={channelTitle}
            caption={pop.caption}
            expanded={captionOpen}
            onToggle={() => setCaptionOpen((open) => !open)}
            onOpenChannel={onOpenChannel}
          />
          <PopSideColumn
            reactions={reactions}
            viewsCount={pop.viewsCount}
            onReaction={tapReaction}
            onAddReaction={setPicker}
          />
        </View>
      )}

      <View style={[styles.progressDock, { bottom: insets.bottom }]} pointerEvents="box-none">
        <PopProgressBar
          width={width}
          durationMs={pop.durationMs}
          progress={progress}
          scrubbing={scrubbing}
          onSeek={seek}
          onScrubChange={setScrubbingNow}
        />
      </View>

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
