// Ползунок на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { CheckerShader } from './checker';
import { styles } from './styles';

import { inkOf } from '@/features/media/photoEdits/drawing';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type DrawAlphaSliderProps = {
  /** Цвет кисти — градиент полосы от прозрачного к нему непрозрачному. */
  color: string;
  /** Прозрачность, 0…1: слева полностью прозрачное, справа непрозрачное. */
  alpha: SharedValue<number>;
};

/** Положение пальца на полосе → прозрачность: центр бегунка ходит в пределах полосы. */
function alphaAt(x: number, width: number): number {
  'worklet';
  const thumb = Sizes.drawAlphaThumb;
  const travel = width - thumb;

  if (travel <= 0) return 1;

  return Math.min(1, Math.max(0, (x - thumb / 2) / travel));
}

/**
 * Ползунок прозрачности цвета: полоса — шахматная клетка, поверх неё
 * выбранный цвет градиентом от прозрачного к непрозрачному. Тянуть можно за
 * всю полосу, тап ставит бегунок в точку. Цвет кисти сам не меняет: с этой
 * прозрачностью применится следующий выбранный цвет.
 */
export function DrawAlphaSlider({ color, alpha }: DrawAlphaSliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const track = Sizes.drawAlphaTrack;
  const top = (Sizes.drawAlphaThumb - track) / 2;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((event) => {
          alpha.value = alphaAt(event.x, width);
        })
        .onUpdate((event) => {
          alpha.value = alphaAt(event.x, width);
        }),
    [alpha, width],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    left: alpha.value * Math.max(0, width - Sizes.drawAlphaThumb),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="draw-alpha"
        accessibilityRole="adjustable"
        accessibilityLabel="Прозрачность цвета"
        style={styles.alphaSlider}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Canvas
            style={{ position: 'absolute', width, height: Sizes.drawAlphaThumb }}
            pointerEvents="none"
          >
            <RoundedRect x={0} y={top} width={width} height={track} r={track / 2}>
              <CheckerShader />
            </RoundedRect>
            <RoundedRect x={0} y={top} width={width} height={track} r={track / 2}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(width, 0)}
                colors={[inkOf(color, 0), inkOf(color, 1)]}
              />
            </RoundedRect>
          </Canvas>
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.alphaThumb,
            { borderColor: theme.textOnMedia },
            thumbStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}
