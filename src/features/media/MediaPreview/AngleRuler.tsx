// Линейка на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ ей пользоваться.
/* eslint-disable react-hooks/immutability */
import { Canvas, Group, matchFont, Path, Rect, Skia, Text } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { currentCrop, type CropMotion } from './cropMotion';
import { styles } from './styles';
import { GRID_FADE_MS, RECENTER_DELAY_MS, RECENTER_MS, settleCrop } from './useCropGestures';
import { startCropTransition } from './useCropTool';

import { MAX_FINE_ANGLE, withAngle, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

/** Ближе этого к нулю угол прилипает к нулю — ровно поставить легко. */
const ZERO_SNAP = 0.3;

export type AngleRulerProps = {
  motion: CropMotion;
  rotationBase: SharedValue<PhotoCrop | null>;
};

function haptic() {
  void Haptics.selectionAsync();
}

/** «-7.6°», ноль — «0°». */
export function formatAngle(angle: number): string {
  'worklet';
  const rounded = Math.round(angle * 10) / 10;

  return rounded === 0 ? '0°' : `${rounded.toFixed(1)}°`;
}

/**
 * Шкала точного поворота: деления по градусу, каждое пятое длиннее; над
 * ними текущий угол. Свайп крутит фото в пределах ±45° вслед за пальцем,
 * проход через ноль отмечается лёгкой вибрацией. Всё на UI-потоке: React
 * перерисовывает линейку только ради подписи для чтения с экрана.
 */
export function AngleRuler({ motion, rotationBase }: AngleRulerProps) {
  const theme = useTheme();
  const width = useSharedValue(0);
  const startAngle = useSharedValue(0);
  const [settled, setSettled] = useState(0);
  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
        fontSize: Sizes.cropAngleFont,
        fontWeight: '600',
      }),
    [],
  );

  const angle = useDerivedValue(() => currentCrop(motion).angle);

  useAnimatedReaction(
    () => Math.round(angle.value),
    (now, before) => {
      if (now !== before) runOnJS(setSettled)(now);
    },
  );

  // Деления в своих координатах: ноль в нуле, градус — `cropRulerStep` точек.
  const ticks = useMemo(() => {
    const path = Skia.Path.Make();

    for (let degree = -MAX_FINE_ANGLE; degree <= MAX_FINE_ANGLE; degree += 1) {
      const height = degree % 5 === 0 ? Sizes.cropTickMajor : Sizes.cropTick;

      path.addRect(
        Skia.XYWHRect(
          degree * Sizes.cropRulerStep - Sizes.cropBorder / 2,
          Sizes.cropRulerHeight - height,
          Sizes.cropBorder,
          height,
        ),
      );
    }

    return path;
  }, []);

  const shift = useDerivedValue(() => [
    { translateX: width.value / 2 - angle.value * Sizes.cropRulerStep },
  ]);
  const label = useDerivedValue(() => formatAngle(angle.value));
  const labelX = useDerivedValue(() => (width.value - font.getTextWidth(label.value)) / 2);
  const centerX = useDerivedValue(() => width.value / 2 - Sizes.cropBorder);

  const pan = useMemo(
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

          const raw = startAngle.value - event.translationX / Sizes.cropRulerStep;
          const clamped = Math.max(-MAX_FINE_ANGLE, Math.min(MAX_FINE_ANGLE, raw));
          const next = Math.abs(clamped) < ZERO_SNAP ? 0 : clamped;
          const previous = motion.crop.value.angle;

          if (next === previous) return;

          if ((next === 0 && previous !== 0) || next * previous < 0) runOnJS(haptic)();

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

  return (
    <GestureDetector gesture={pan}>
      <View
        testID="crop-ruler"
        accessibilityRole="adjustable"
        accessibilityLabel="Поворот"
        accessibilityValue={{ min: -MAX_FINE_ANGLE, max: MAX_FINE_ANGLE, now: settled }}
        style={styles.ruler}
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width;
        }}
      >
        <Canvas style={styles.rulerCanvas}>
          <Text
            x={labelX}
            y={Sizes.cropAngleFont}
            text={label}
            font={font}
            color={theme.textOnMedia}
          />
          <Group transform={shift}>
            <Path path={ticks} color={theme.textOnMedia} opacity={Opacity.cropTick} />
          </Group>
          <Rect
            x={centerX}
            y={Sizes.cropRulerHeight - Sizes.cropTickCenter}
            width={Sizes.cropBorder * 2}
            height={Sizes.cropTickCenter}
            color={theme.textOnMedia}
          />
        </Canvas>
      </View>
    </GestureDetector>
  );
}
