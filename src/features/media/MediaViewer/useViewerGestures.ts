// Жесты просмотрщика на низкоуровневом API Reanimated: мутация `.value` у
// shared value — штатный способ им пользоваться, а не нарушение чистоты.
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  clampWithRubber,
  DOUBLE_TAP_SCALE,
  dismissOpacity,
  MAX_SCALE,
  panBound,
  resolveDismiss,
  resolvePage,
  rubberBand,
  zoomAround,
} from './viewerMath';

const PAGE_MS = 240;
const DISMISS_MS = 200;
const SPRING = { damping: 28, stiffness: 260, mass: 0.9 };
/** Сдвиг пальца, после которого жест узнаёт направление. */
const PAN_ACTIVATION = 10;
/** Щипком можно чуть уйти за пределы увеличения — пружина вернёт. */
const PINCH_OVERSHOOT = 1.2;
const MIN_PINCH = 0.8;
/** Увеличено ли — с запасом на погрешность пружины. */
const ZOOMED = 1.01;

type Mode = 'idle' | 'page' | 'dismiss' | 'pan';

type Params = {
  count: number;
  initialIndex: number;
  width: number;
  height: number;
  /** Размер активного медиа, вписанного в экран: по нему считаются края при увеличении. */
  contentWidth: number;
  contentHeight: number;
  onPageChange: (index: number) => void;
  onTap: () => void;
  onClose: () => void;
};

/**
 * Все жесты просмотрщика одним набором, как в Telegram:
 *
 * - без увеличения направление решают первые dp движения: по горизонтали —
 *   листание альбома, по вертикали — медиа едет за пальцем, фон светлеет, и
 *   за порогом или броском просмотр закрывается в ту же сторону;
 * - щипок увеличивает с центром между пальцами, двойной тап — в точку тапа
 *   или обратно;
 * - увеличенное медиа панорамируется с упором в края и резиной; упёрлось в
 *   край по горизонтали — тот же палец дальше листает альбом;
 * - одиночный тап (пауза видео) ждёт, не окажется ли он двойным.
 */
export function useViewerGestures({
  count,
  initialIndex,
  width,
  height,
  contentWidth,
  contentHeight,
  onPageChange,
  onTap,
  onClose,
}: Params) {
  const index = useSharedValue(initialIndex);
  const pageX = useSharedValue(-initialIndex * width);
  const pageStart = useSharedValue(0);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const mode = useSharedValue<Mode>('idle');
  const closing = useSharedValue(false);
  const contentW = useSharedValue(contentWidth);
  const contentH = useSharedValue(contentHeight);

  useEffect(() => {
    contentW.value = contentWidth;
    contentH.value = contentHeight;
  }, [contentH, contentHeight, contentW, contentWidth]);

  const gesture = useMemo(() => {
    const resetZoom = () => {
      'worklet';
      scale.value = withSpring(1, SPRING);
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
    };

    const goToPage = (target: number) => {
      'worklet';
      const changed = target !== index.value;

      index.value = target;
      pageX.value = withTiming(-target * width, { duration: PAGE_MS });

      if (changed) {
        // Соседняя страница всегда открывается без увеличения.
        scale.value = 1;
        tx.value = 0;
        ty.value = 0;
        runOnJS(onPageChange)(target);
      }
    };

    /** Листание за край альбома — с резиной: дальше первой и последней страниц не уехать. */
    const pagerOffset = (drag: number) => {
      'worklet';
      const raw = pageStart.value + drag;
      const min = -(count - 1) * width;

      if (raw > 0) return rubberBand(raw, width);
      if (raw < min) return min + rubberBand(raw - min, width);

      return raw;
    };

    const pan = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-PAN_ACTIVATION, PAN_ACTIVATION])
      .activeOffsetY([-PAN_ACTIVATION, PAN_ACTIVATION])
      .onStart(() => {
        pageStart.value = pageX.value;
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        mode.value = scale.value > ZOOMED ? 'pan' : 'idle';
      })
      .onUpdate((event) => {
        if (closing.value) return;

        if (mode.value === 'idle') {
          // Сдвиг считается от точки, где жест узнал себя, и первый кадр
          // приходит нулевым — направление решает первое настоящее движение.
          if (event.translationX === 0 && event.translationY === 0) return;

          mode.value =
            Math.abs(event.translationX) > Math.abs(event.translationY) ? 'page' : 'dismiss';
        }

        if (mode.value === 'page') {
          pageX.value = pagerOffset(event.translationX);
          return;
        }

        if (mode.value === 'dismiss') {
          dismissY.value = event.translationY;
          return;
        }

        // Увеличенное: сдвиг в пределах краёв, а то, что за краем по
        // горизонтали, листает альбом.
        const boundX = panBound(contentW.value, width, scale.value);
        const boundY = panBound(contentH.value, height, scale.value);
        const wantX = savedTx.value + event.translationX;
        const clampedX = Math.max(-boundX, Math.min(boundX, wantX));

        tx.value = clampedX;
        pageX.value = pagerOffset(wantX - clampedX);
        ty.value = clampWithRubber(savedTy.value + event.translationY, boundY, height);
      })
      .onEnd((event) => {
        if (closing.value) return;

        if (mode.value === 'dismiss') {
          const direction = resolveDismiss(event.translationY, event.velocityY, height);

          if (direction === 0) {
            dismissY.value = withSpring(0, SPRING);
            return;
          }

          closing.value = true;
          dismissY.value = withTiming(direction * height, { duration: DISMISS_MS }, (finished) => {
            if (finished) runOnJS(onClose)();
          });
          return;
        }

        const dragX = pageX.value - pageStart.value;

        if (mode.value === 'page' || dragX !== 0) {
          goToPage(resolvePage(index.value, count, dragX, event.velocityX, width));
        }

        if (mode.value === 'pan') {
          // Отпустили за краем по вертикали — резина возвращает к краю.
          const boundY = panBound(contentH.value, height, scale.value);

          ty.value = withSpring(Math.max(-boundY, Math.min(boundY, ty.value)), SPRING);
        }
      })
      .onFinalize(() => {
        mode.value = 'idle';
      });

    const pinch = Gesture.Pinch()
      .onStart((event) => {
        savedScale.value = scale.value;
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        focalX.value = event.focalX - width / 2;
        focalY.value = event.focalY - height / 2;
      })
      .onUpdate((event) => {
        if (closing.value) return;

        const next = Math.max(
          MIN_PINCH,
          Math.min(MAX_SCALE * PINCH_OVERSHOOT, savedScale.value * event.scale),
        );
        // Точка между пальцами остаётся под ними, а сдвиг пальцев двигает медиа.
        const movedX = event.focalX - width / 2 - focalX.value;
        const movedY = event.focalY - height / 2 - focalY.value;

        scale.value = next;
        tx.value = zoomAround(focalX.value, savedTx.value, savedScale.value, next) + movedX;
        ty.value = zoomAround(focalY.value, savedTy.value, savedScale.value, next) + movedY;
      })
      .onEnd(() => {
        if (scale.value <= 1) {
          resetZoom();
          return;
        }

        const target = Math.min(MAX_SCALE, scale.value);
        const boundX = panBound(contentW.value, width, target);
        const boundY = panBound(contentH.value, height, target);

        scale.value = withSpring(target, SPRING);
        tx.value = withSpring(Math.max(-boundX, Math.min(boundX, tx.value)), SPRING);
        ty.value = withSpring(Math.max(-boundY, Math.min(boundY, ty.value)), SPRING);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((event, success) => {
        if (!success || closing.value) return;

        if (scale.value > ZOOMED) {
          resetZoom();
          return;
        }

        const boundX = panBound(contentW.value, width, DOUBLE_TAP_SCALE);
        const boundY = panBound(contentH.value, height, DOUBLE_TAP_SCALE);
        const toX = zoomAround(event.x - width / 2, 0, 1, DOUBLE_TAP_SCALE);
        const toY = zoomAround(event.y - height / 2, 0, 1, DOUBLE_TAP_SCALE);

        scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING);
        tx.value = withSpring(Math.max(-boundX, Math.min(boundX, toX)), SPRING);
        ty.value = withSpring(Math.max(-boundY, Math.min(boundY, toY)), SPRING);
      });

    const singleTap = Gesture.Tap()
      .withTestId('media-viewer-tap')
      .requireExternalGestureToFail(doubleTap)
      .onEnd((_event, success) => {
        if (success) runOnJS(onTap)();
      });

    return Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, singleTap));
  }, [
    closing,
    contentH,
    contentW,
    count,
    dismissY,
    focalX,
    focalY,
    height,
    index,
    mode,
    onClose,
    onPageChange,
    onTap,
    pageStart,
    pageX,
    savedScale,
    savedTx,
    savedTy,
    scale,
    tx,
    ty,
    width,
  ]);

  const pagerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pageX.value }] }));

  const activeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + dismissY.value },
      { scale: scale.value },
    ],
  }));

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: dismissOpacity(dismissY.value, height),
  }));

  return { gesture, pagerStyle, activeStyle, backgroundStyle };
}
