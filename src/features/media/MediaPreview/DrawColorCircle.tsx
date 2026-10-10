import { Canvas, Circle, SweepGradient, vec } from '@shopify/react-native-skia';
import { Pressable } from 'react-native';

import { CheckerShader } from './checker';
import { styles } from './styles';

import { ColorWheel, DrawColors, Opacity, Sizes, Spacing } from '@/theme';

export type DrawColorCircleProps = {
  /** Цвет кисти `#rrggbbaa`; нет — у кисти цвета нет (размытие, ластик). */
  color: string | null;
  onPress: () => void;
};

/**
 * Кружок текущего цвета: обводка — цветовой круг, внутри цвет кисти поверх
 * шахматной клетки — так видна его прозрачность. Тап открывает панель цвета.
 * У кисти без цвета кружок серый, с пустой клеткой внутри, приглушён и не
 * нажимается.
 */
export function DrawColorCircle({ color, onPress }: DrawColorCircleProps) {
  const side = Sizes.drawColorCircle;
  const center = side / 2;
  const ring = Sizes.drawColorRing;
  const inner = center - ring * 2;

  return (
    <Pressable
      testID="draw-color"
      accessibilityRole="button"
      accessibilityLabel={color ? 'Цвет кисти' : 'У этой кисти нет цвета'}
      accessibilityState={{ disabled: !color }}
      disabled={!color}
      hitSlop={Spacing.one}
      onPress={onPress}
      style={[styles.tool, !color && { opacity: Opacity.toolIdle }]}
    >
      <Canvas style={{ width: side, height: side }} pointerEvents="none">
        <Circle
          cx={center}
          cy={center}
          r={center - ring / 2}
          style="stroke"
          strokeWidth={ring}
          color={DrawColors.neutralRing}
        >
          {color ? <SweepGradient c={vec(center, center)} colors={ColorWheel} /> : null}
        </Circle>
        <Circle cx={center} cy={center} r={inner}>
          <CheckerShader />
        </Circle>
        {color ? <Circle cx={center} cy={center} r={inner} color={color} /> : null}
      </Canvas>
    </Pressable>
  );
}
