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

import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type DrawSizeSliderProps = {
  /** Толщина кисти в точках экрана. */
  size: SharedValue<number>;
  min: number;
  max: number;
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
 * диаметр — текущая толщина; тянуть можно за всю полосу. Пока тянут, фото
 * показывает превью-кружок той же толщины.
 */
export function DrawSizeSlider({ size, min, max, sizing, onCommit }: DrawSizeSliderProps) {
  const theme = useTheme();
  const start = useSharedValue(0);
  const wedge = useMemo(() => wedgePath(), []);
  const height = Sizes.drawSliderHeight;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          start.value = size.value;
          sizing.value = 1;
        })
        .onUpdate((event) => {
          const next = start.value - (event.translationY / height) * (max - min);

          size.value = Math.min(max, Math.max(min, next));
        })
        .onFinalize(() => {
          sizing.value = 0;
          runOnJS(onCommit)(size.value);
        }),
    [height, max, min, onCommit, size, sizing, start],
  );

  const thumbStyle = useAnimatedStyle(() => {
    const value = Math.min(max, Math.max(min, size.value));
    const share = max > min ? (value - min) / (max - min) : 0;

    return {
      width: value,
      height: value,
      borderRadius: value / 2,
      left: (Sizes.drawSliderHit - value) / 2,
      top: height * (1 - share) - value / 2,
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
          style={[
            styles.sizeThumb,
            { backgroundColor: theme.textOnMedia, borderColor: theme.viewerBackground },
            thumbStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}
