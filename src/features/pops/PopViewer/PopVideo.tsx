import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { Pop } from '@/api/pops';

/** Как часто плеер сообщает время — полоса прогресса двигается плавно. */
const TIME_UPDATE_S = 0.1;

/** Вертикальное видео заполняет экран, как в TikTok; остальное вписывается целиком. */
const FILL_ASPECT = 1.5;

export type PopVideoProps = {
  pop: Pop;
  /**
   * Показывать видео. Прогреваемый плеер буферизуется без вида: TextureView,
   * созданный за краем экрана, на Android так и остаётся чёрным, когда
   * страница приезжает.
   */
  attached: boolean;
  /** Играть сейчас: страница активна, экран наверху, приложение не в фоне, нет паузы. */
  playing: boolean;
  /** 2× — пока держат палец. */
  fast: boolean;
  /** Доля просмотренного — пишет плеер, пока полосу не тянут. */
  progress: SharedValue<number>;
  /** Полосу тянут — время от плеера её не перебивает. */
  scrubbing: SharedValue<boolean>;
  /** Перемотка на долю длительности — для полосы прогресса. */
  seekRef: RefObject<((share: number) => void) | null>;
  /** Вид показал первый кадр — обложку поверх можно убрать. */
  onFirstFrame: () => void;
};

/**
 * Плеер страницы попа. Живёт только у активной страницы и следующей за ней
 * (прогрев): остальные страницы — обложки, а их плееры освобождаются вместе с
 * этим компонентом. До первого кадра поверх видео лежит обложка (её рисует
 * страница): прозрачность самого вида на Android не годится — TextureView с
 * ней терял кадры и оставался чёрным.
 */
export function PopVideo({
  pop,
  attached,
  playing,
  fast,
  progress,
  scrubbing,
  seekRef,
  onFirstFrame,
}: PopVideoProps) {
  const player = useVideoPlayer(pop.url, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = TIME_UPDATE_S;
  });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);

  useEffect(() => {
    // Плеер expo-video управляется присваиванием свойств — это его API.
    // eslint-disable-next-line react-hooks/immutability
    player.playbackRate = fast ? 2 : 1;
  }, [fast, player]);

  useEffect(() => {
    const duration = pop.durationMs / 1000;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (!scrubbing.get()) progress.set(Math.min(1, currentTime / duration));
    });

    return () => subscription.remove();
  }, [player, pop.durationMs, progress, scrubbing]);

  useEffect(() => {
    seekRef.current = (share) => {
      player.currentTime = share * (pop.durationMs / 1000);
    };

    return () => {
      seekRef.current = null;
    };
  }, [player, pop.durationMs, seekRef]);

  if (!attached) return null;

  // Касаний вид не получает: нативный плеер на Android забирал их у
  // листания, и свайп обрывался на полпути.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        testID="pop-video"
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={pop.height / pop.width >= FILL_ASPECT ? 'cover' : 'contain'}
        nativeControls={false}
        onFirstFrameRender={onFirstFrame}
      />
    </View>
  );
}
