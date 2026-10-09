import { Canvas, Circle, SweepGradient, vec } from '@shopify/react-native-skia';
import { View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { ColorWheel, Sizes } from '@/theme';

export type DrawColorCircleProps = {
  /** Цвет кисти; нет — у кисти цвета нет (размытие, ластик), кружок нейтральный. */
  color: string | null;
};

/**
 * Кружок текущего цвета: обводка — цветовой круг, внутри цвет кисти. Выбор
 * цвета — следующий этап, пока кружок только показывает.
 */
export function DrawColorCircle({ color }: DrawColorCircleProps) {
  const theme = useTheme();
  const side = Sizes.drawColorCircle;
  const center = side / 2;
  const ring = Sizes.drawColorRing;

  return (
    <View
      testID="draw-color"
      accessible
      accessibilityLabel={color ? 'Цвет кисти' : 'У этой кисти нет цвета'}
      style={styles.tool}
    >
      <Canvas style={{ width: side, height: side }}>
        <Circle cx={center} cy={center} r={center - ring / 2} style="stroke" strokeWidth={ring}>
          <SweepGradient c={vec(center, center)} colors={ColorWheel} />
        </Circle>
        <Circle cx={center} cy={center} r={center - ring * 2} color={color ?? theme.mediaControl} />
      </Canvas>
    </View>
  );
}
