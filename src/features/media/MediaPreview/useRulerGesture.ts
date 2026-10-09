// Жест на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import type { CropMotion } from './cropMotion';
import { crossesZero, rulerAngle } from './rulerMath';
import { GRID_FADE_MS, RECENTER_DELAY_MS, RECENTER_MS, settleCrop } from './useCropGestures';
import { startCropTransition } from './useCropTool';

import { withAngle, type PhotoCrop } from '@/features/media/photoEdits/crop';

function haptic() {
  void Haptics.selectionAsync();
}

/** Свайп по линейке крутит фото вслед за пальцем, без React на кадр. */
export function useRulerGesture(motion: CropMotion, rotationBase: SharedValue<PhotoCrop | null>) {
  const startAngle = useSharedValue(0);

  return useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          settleCrop(motion);
          // Опора поворота живёт между жестами линейки: вернул угол к
          // прежнему — вернулось и увеличение.
          if (!rotationBase.value) rotationBase.value = motion.crop.value;
          startAngle.value = motion.crop.value.angle;
          motion.grid.value = withTiming(1, { duration: GRID_FADE_MS });
        })
        .onUpdate((event) => {
          const base = rotationBase.value;

          if (!base) return;

          const next = rulerAngle(startAngle.value, event.translationX);
          const previous = motion.crop.value.angle;

          if (next === previous) return;

          if (crossesZero(previous, next)) runOnJS(haptic)();

          motion.crop.value = withAngle(base, next);
        })
        .onFinalize(() => {
          motion.grid.value = withTiming(0, { duration: GRID_FADE_MS });

          // Рамку тянули и не успели доцентровать — встанет по центру сейчас.
          if (motion.frame.value !== null) {
            startCropTransition(motion, motion.crop.value, {
              cover: true,
              duration: RECENTER_MS,
              delay: RECENTER_DELAY_MS,
            });
          }
        }),
    [motion, rotationBase, startAngle],
  );
}
