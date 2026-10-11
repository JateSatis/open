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
  /**
   * Видео пошло после того, как страница стала активной, — обложку поверх
   * можно убрать. Не «первый кадр»: прогретый вид рисует его ещё за краем
   * экрана, и на приехавшей странице до новых кадров была бы чернота.
   */
  onPlaying: () => void;
};

/**
 * Плеер страницы попа. Живёт только у активной страницы и следующей за ней
 * (прогрев): остальные страницы — обложки, а их плееры освобождаются вместе с
 * этим компонентом. Вид подключён и у прогрева: смена поверхности у уже
 * готового плеера на Android давала пустую текстуру. Пока видео не пошло,
 * поверх лежит обложка (её рисует страница).
 */
export function PopVideo({
  pop,
  playing,
  fast,
  progress,
  scrubbing,
  seekRef,
  onPlaying,
}: PopVideoProps) {
  const player = useVideoPlayer(pop.url, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = TIME_UPDATE_S;
  });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);

  // Время сдвинулось после запуска — кадры идут на экран.
  useEffect(() => {
    if (!playing) return;

    let startedAt: number | null = null;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (startedAt === null) startedAt = currentTime;
      else if (currentTime !== startedAt) {
        subscription.remove();
        onPlaying();
      }
    });

    return () => subscription.remove();
  }, [onPlaying, player, playing]);

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
        // TextureView рисуется как обычный вью и едет вместе с лентой. У
        // SurfaceView своя поверхность вне дерева: при сдвиге ленты и двух
        // плеерах сразу она мигала чёрным между кадрами.
        surfaceType="textureView"
      />
    </View>
  );
}
