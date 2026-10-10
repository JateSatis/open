import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeartBurst, randomTilt, type Heart } from './HeartBurst';
import { PopCaption } from './PopCaption';
import { PopProgressBar } from './PopProgressBar';
import { PopReactionPopover, type PopoverAnchor } from './PopReactionPopover';
import { PopSideColumn } from './PopSideColumn';
import { PopVideo } from './PopVideo';
import { styles } from './styles';
import { useSurfacePress } from './useSurfacePress';

import type { Pop } from '@/api/pops';
import { Text } from '@/components/Text';
import { usePendingReactions } from '@/features/interactions/pendingReactions';
import { PopCover } from '@/features/pops/PopCover';
import { withPendingPopReaction } from '@/features/pops/popReactions';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

const FADE_MS = 150;

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
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const [scrubbingNow, setScrubbingNow] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [picker, setPicker] = useState<PopoverAnchor | null>(null);
  const [hearts, setHearts] = useState<Heart[]>([]);
  // Кадр видео уже на экране — обложка поверх убирается.
  const [framed, setFramed] = useState(false);
  const heartKey = useRef(0);
  const progress = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const seekRef = useRef<((share: number) => void) | null>(null);

  const pending = usePendingReactions((state) => state.byMessage[pop.id]);
  const reactions = withPendingPopReaction(pop.reactions, pending);

  // Ушёл со страницы — вернётся к игре, а не к паузе и не к раскрытой подписи.
  useEffect(() => {
    if (active) return;

    setPaused(false);
    setFast(false);
    setCaptionOpen(false);
    setPicker(null);
    setFramed(false);
  }, [active]);

  const showFrame = useCallback(() => setFramed(true), []);
  const togglePause = useCallback(() => setPaused((value) => !value), []);
  const doubleTap = useCallback(
    (x: number, y: number) => {
      heartKey.current += 1;
      setHearts((list) => [...list, { key: heartKey.current, x, y, tilt: randomTilt() }]);
      onDoubleTap(pop);
    },
    [onDoubleTap, pop],
  );
  const dropHeart = useCallback(
    (key: number) => setHearts((list) => list.filter((heart) => heart.key !== key)),
    [],
  );

  const surfacePress = useSurfacePress({
    onTap: togglePause,
    onDoubleTap: doubleTap,
    onHold: setFast,
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
          onPlaying={showFrame}
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

      {paused && active ? (
        <Animated.View
          testID="pop-paused"
          entering={FadeIn.duration(FADE_MS)}
          exiting={FadeOut.duration(FADE_MS)}
          style={styles.center}
          pointerEvents="none"
        >
          <SymbolView
            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
            size={Sizes.popPauseIcon}
            tintColor={theme.textOnMediaSecondary}
          />
        </Animated.View>
      ) : null}

      {fast && active ? (
        <View
          testID="pop-fast"
          style={[styles.fastBadge, { top: insets.top, backgroundColor: theme.mediaScrim }]}
          pointerEvents="none"
        >
          <Text variant="smallBold" color="textOnMedia">
            2×
          </Text>
        </View>
      ) : null}

      {hearts.map((heart) => (
        <HeartBurst key={heart.key} heart={heart} onDone={dropHeart} />
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
