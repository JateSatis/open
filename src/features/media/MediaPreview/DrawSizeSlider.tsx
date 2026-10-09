// Ползунок на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { styles } from './styles';

import { dragSize, thumbCenter } from '@/features/media/sizeSlider';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type DrawSizeSliderProps = {
  /** Толщина кисти в точках экрана. */
  size: SharedValue<number>;
  /** 1 — ползунок тянут: на фото виден превью-кружок. */
  sizing: SharedValue<number>;
  onCommit: (size: number) => void;
};

/** Шкала-клин: снизу узко, сверху широко — как толщина, которую она задаёт. */
function wedgePath() {
  const height = Sizes.drawSliderHeight;
  const center = Sizes.drawSliderHit / 2;
  const path = Skia.Path.Make();

  path.moveTo(center - Sizes.drawSliderWide / 2, 0);
  path.lineTo(center + Sizes.drawSliderWide / 2, 0);
  path.lineTo(center + Sizes.drawSliderNarrow / 2, height);
  path.lineTo(center - Sizes.drawSliderNarrow / 2, height);
  path.close();

  return path;
}

/**
 * Вертикальный ползунок толщины у правого края. Тянут за кружок, его
 * диаметр — текущая толщина, и он всегда внутри клина; тянуть можно за всю
 * полосу. Пока тянут, фото показывает превью-кружок той же толщины.
 */
export function DrawSizeSlider({ size, sizing, onCommit }: DrawSizeSliderProps) {
  const theme = useTheme();
  const start = useSharedValue(0);
  const wedge = useMemo(() => wedgePath(), []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          start.value = size.value;
          sizing.value = 1;
        })
        .onUpdate((event) => {
          size.value = dragSize(start.value, event.translationY);
        })
        .onFinalize(() => {
          sizing.value = 0;
          runOnJS(onCommit)(size.value);
        }),
    [onCommit, size, sizing, start],
  );

  const thumbStyle = useAnimatedStyle(() => {
    const value = size.value;

    return {
      width: value,
      height: value,
      borderRadius: value / 2,
      left: (Sizes.drawSliderHit - value) / 2,
      top: thumbCenter(value) - value / 2,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="draw-size"
        accessibilityRole="adjustable"
        accessibilityLabel="Толщина кисти"
        style={styles.sizeSlider}
      >
        <Canvas style={styles.sizeTrack} pointerEvents="none">
          <Path path={wedge} color={theme.textOnMedia} opacity={Opacity.drawSliderTrack} />
        </Canvas>
        <Animated.View
          pointerEvents="none"
          style={[styles.sizeThumb, { backgroundColor: theme.textOnMedia }, thumbStyle]}
        />
      </View>
    </GestureDetector>
  );
}
