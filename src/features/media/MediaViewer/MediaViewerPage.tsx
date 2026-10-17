import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';
import type { ViewerMotion } from './useViewerFlight';
import { fittedSize } from './viewerMath';

import type { MediaViewerItem } from './types';

import { fitRect, flightTransform } from '@/features/media/MediaPreview/previewGeometry';
import type { Rect } from '@/features/media/tileRegistry';

export type MediaViewerPageProps = {
  item: MediaViewerItem;
  width: number;
  height: number;
  /** Только активная страница играет и летает — соседи по свайпу молчат. */
  isActive: boolean;
  motion: ViewerMotion;
  /**
   * Размер плитки, из которой открыли эту страницу. Её картинка того же
   * размера уже лежит в памяти `expo-image` — перелёт начинается с неё, не
   * дожидаясь полного качества. `null` — страницу открыли листанием.
   */
  sourceTile: { width: number; height: number } | null;
  /** Перелёт закончился: видео можно запускать. */
  settled: boolean;
  /** Просмотр уходит: видео уступает место постеру. */
  leaving: boolean;
  /** Картинка плитки нарисована — пора лететь. */
  onSourceShown?: () => void;
  /**
   * Пауза по тапу. Тап ловит общий жест просмотрщика (он отличает его от
   * двойного), а страница отдаёт ему свой переключатель. `null` — снят.
   */
  onToggleReady: (toggle: (() => void) | null) => void;
};

/** Медиа, вписанное в экран целиком, по центру. */
export function viewerBase(item: MediaViewerItem, width: number, height: number): Rect {
  const size = fittedSize(
    { width: item.width ?? null, height: item.height ?? null },
    { width, height },
  );

  return {
    x: (width - size.width) / 2,
    y: (height - size.height) / 2,
    width: size.width,
    height: size.height,
  };
}

/**
 * Страница просмотра: рамка с обрезкой по краям, внутри — картинка плитки,
 * над ней полное качество, у видео — плеер после перелёта. Перелёт —
 * одними трансформами (`flightTransform`), как у предпросмотра шита медиа:
 * рамка тянется от плитки до вписанного медиа, картинка внутри гасит
 * растяжение встречным масштабом.
 */
export const MediaViewerPage = memo(function MediaViewerPage({
  item,
  width,
  height,
  isActive,
  motion,
  sourceTile,
  settled,
  leaving,
  onSourceShown,
  onToggleReady,
}: MediaViewerPageProps) {
  const base = useMemo(() => viewerBase(item, width, height), [height, item, width]);
  const isVideo = item.kind === 'video';

  const frameStyle = useAnimatedStyle(() => {
    const target = isActive && motion.from.value ? motion.from.value : base;
    const { frame } = flightTransform(
      base,
      target,
      isActive ? motion.origin.value : null,
      isActive ? motion.flight.value : 1,
    );

    // Скругление плитки: у углов облачка она скруглена, на месте медиа —
    // нет. Рамка растянута трансформом, радиус пересчитан под её масштаб.
    const corners = isActive ? motion.origin.value?.corners : undefined;
    const fold = corners
      ? (1 - (isActive ? motion.flight.value : 1)) / Math.sqrt(frame.scaleX * frame.scaleY)
      : 0;

    return {
      opacity: isActive ? motion.fade.value : 1,
      borderTopLeftRadius: (corners?.topLeft ?? 0) * fold,
      borderTopRightRadius: (corners?.topRight ?? 0) * fold,
      borderBottomLeftRadius: (corners?.bottomLeft ?? 0) * fold,
      borderBottomRightRadius: (corners?.bottomRight ?? 0) * fold,
      transform: [
        { translateX: frame.translateX },
        { translateY: frame.translateY },
        { scaleX: frame.scaleX },
        { scaleY: frame.scaleY },
      ],
    };
  });

  const imageStyle = useAnimatedStyle(() => {
    const target = isActive && motion.from.value ? motion.from.value : base;
    const { image } = flightTransform(
      base,
      target,
      isActive ? motion.origin.value : null,
      isActive ? motion.flight.value : 1,
    );

    return { transform: [{ scaleX: image.scaleX }, { scaleY: image.scaleY }] };
  });

  // Картинка плитки — ровно её размером, растянутая трансформом до рамки:
  // тот же размер с тем же источником `expo-image` берёт из памяти сразу.
  const thumbBox = useMemo(() => {
    if (!sourceTile || !item.thumbUrl) return null;

    const shown = fitRect(base.width / base.height, {
      x: 0,
      y: 0,
      width: sourceTile.width,
      height: sourceTile.height,
    });

    return {
      width: sourceTile.width,
      height: sourceTile.height,
      left: (base.width - sourceTile.width) / 2,
      top: (base.height - sourceTile.height) / 2,
      transform: [{ scale: base.width / shown.width }],
    };
  }, [base, item.thumbUrl, sourceTile]);

  const poster = isVideo ? item.thumbUrl : null;

  return (
    <View style={{ width, height }}>
      <Animated.View
        style={[
          styles.frame,
          { left: base.x, top: base.y, width: base.width, height: base.height },
          frameStyle,
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          {thumbBox && item.thumbUrl ? (
            <View style={[styles.thumb, thumbBox]}>
              <Image
                source={{ uri: item.thumbUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                onDisplay={onSourceShown}
                onError={onSourceShown}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : null}

          {isVideo ? (
            <>
              {poster && !thumbBox ? (
                <Image
                  source={{ uri: poster }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              {/* Плеер — только на месте: поверхность видео в перелёте
                  трансформам не верна, а первые кадры бывают чёрными. */}
              {isActive && settled && !leaving ? (
                <ViewerVideo item={item} onToggleReady={onToggleReady} />
              ) : null}
            </>
          ) : (
            <Image
              testID="media-viewer-photo"
              source={{ uri: item.url }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
});

type ViewerVideoProps = {
  item: MediaViewerItem;
  onToggleReady: (toggle: (() => void) | null) => void;
};

/**
 * Видео играет само, по кругу, и останавливается по тапу — сложный плеер
 * (перемотка, громкость) сюда сознательно не входит. Показывается с первого
 * настоящего кадра: до него виден постер.
 */
function ViewerVideo({ item, onToggleReady }: ViewerVideoProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [rendered, setRendered] = useState(false);
  const player = useVideoPlayer(item.url, (instance) => {
    instance.loop = true;
    instance.play();
  });

  const toggle = useCallback(() => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  }, [player]);

  useEffect(() => {
    onToggleReady(toggle);

    return () => onToggleReady(null);
  }, [onToggleReady, toggle]);

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Поставить видео на паузу' : 'Воспроизвести видео'}
      onAccessibilityTap={toggle}
      style={[StyleSheet.absoluteFill, !rendered && styles.hidden]}
    >
      {/* TextureView: увеличение и сдвиг — трансформации, а SurfaceView их не
          принимает. */}
      <VideoView
        testID="media-viewer-video"
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        surfaceType="textureView"
        onFirstFrameRender={() => setRendered(true)}
      />
    </View>
  );
}
