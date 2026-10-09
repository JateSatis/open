// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import { Canvas, Group, matchFont, Path, Rect, Skia, Text } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { currentCrop, type CropMotion } from './cropMotion';
import { styles } from './styles';
import { formatAngle } from './rulerMath';
import { useRulerGesture } from './useRulerGesture';

import { MAX_FINE_ANGLE, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type AngleRulerProps = {
  motion: CropMotion;
  rotationBase: SharedValue<PhotoCrop | null>;
};

/**
 * Шкала точного поворота: деления по градусу, каждое пятое длиннее; над
 * ними текущий угол. Свайп крутит фото в пределах ±45° вслед за пальцем,
 * проход через ноль отмечается лёгкой вибрацией. Всё на UI-потоке: React
 * перерисовывает линейку только ради подписи для чтения с экрана.
 */
export function AngleRuler({ motion, rotationBase }: AngleRulerProps) {
  const theme = useTheme();
  const width = useSharedValue(0);
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

  const pan = useRulerGesture(motion, rotationBase);

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
