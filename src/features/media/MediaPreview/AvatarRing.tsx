import { Canvas, FillType, Group, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { LiveDraw } from './useDrawTool';

import { useTheme } from '@/hooks/use-theme';

const NO_ZOOM = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export type AvatarRingProps = {
  width: number;
  height: number;
  /** Насколько круг виден: проявляется с перелётом из плитки и гаснет с ним. */
  visible: SharedValue<number>;
  /** Открыто рисование: круг увеличивается вместе с фото. */
  draw: LiveDraw | null;
};

/**
 * Будущая аватарка поверх фото: круг, вписанный в центральный квадрат, —
 * снаружи затемнение, внутри всё видно. Без обрезки аватарка и есть
 * центральный квадрат (`prepareAvatar`), с обрезкой фото уже квадратное, и
 * круг вписан в него целиком.
 *
 * Лежит в координатах фото, как правка на Skia: едет с перелётом, с рабочей
 * областью инструмента и с увеличением в рисовании. Касаний не принимает.
 */
export function AvatarRing({ width, height, visible, draw }: AvatarRingProps) {
  const theme = useTheme();

  const scrim = useMemo(() => {
    const path = Skia.Path.Make();
    const side = Math.min(width, height);

    path.addRect(Skia.XYWHRect(0, 0, width, height));
    path.addOval(Skia.XYWHRect((width - side) / 2, (height - side) / 2, side, side));
    path.setFillType(FillType.EvenOdd);

    return path;
  }, [height, width]);

  const zoom = useDerivedValue(() => {
    if (!draw) return NO_ZOOM;

    const scale = draw.zoom.scale.value;

    return [scale, 0, draw.zoom.x.value, 0, scale, draw.zoom.y.value, 0, 0, 1];
  });

  const style = useAnimatedStyle(() => ({ opacity: visible.value }));

  return (
    <Animated.View
      testID="media-preview-avatar-ring"
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    >
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group matrix={zoom}>
          <Path path={scrim} color={theme.mediaScrim} />
        </Group>
      </Canvas>
    </Animated.View>
  );
}
