import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { dragPosition, resolveSection } from './pagerMath';

/** Сдвиг пальца по горизонтали, с которого жест узнаёт себя. */
const ACTIVATION_X = 16;
/** Вертикальный сдвиг раньше этого отдаёт касание прокрутке списка. */
const FAIL_Y = 12;
export const SECTION_SETTLE_MS = 260;

export type SectionPagerProps = {
  /** Позиция в разделах: 0 — первый, 1 — второй, дробная — между ними. Её же читает контрол над пейджером. */
  position: SharedValue<number>;
  /** Раздел, на котором пейджер остановился. */
  index: number;
  width: number;
  pages: ReactNode[];
  onIndexChange: (index: number) => void;
};

/**
 * Разделы бок о бок, листаются свайпом. Жест горизонтальный и уступает
 * вертикальной прокрутке. На первом разделе свайп вправо пейджер не берёт:
 * на iOS он уходит системному «назад» от края экрана.
 *
 * Полноэкранный просмотр, шиты и меню — отдельные окна (`Modal`): касания в
 * них сюда не доходят, и пейджер под ними не листается.
 */
export function SectionPager({ position, index, width, pages, onIndexChange }: SectionPagerProps) {
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const count = pages.length;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(index === 0 ? -ACTIVATION_X : [-ACTIVATION_X, ACTIVATION_X])
        .failOffsetY([-FAIL_Y, FAIL_Y])
        // С момента, как жест узнал себя: простое касание поста не трогает
        // докатывающуюся после тапа по контролу позицию.
        .onStart(() => {
          cancelAnimation(position);
          start.set(position.get());
          dragging.set(true);
        })
        .onUpdate((event) => {
          if (!dragging.get()) return;

          position.set(dragPosition(start.get(), event.translationX, width, count));
        })
        .onFinalize((event) => {
          if (!dragging.get()) return;

          dragging.set(false);
          const target = resolveSection(position.get(), event.velocityX, count);

          position.set(withTiming(target, { duration: SECTION_SETTLE_MS }));
          runOnJS(onIndexChange)(target);
        }),
    [count, dragging, index, onIndexChange, position, start, width],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -position.get() * width }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View testID="section-pager" style={styles.window}>
        <Animated.View style={[styles.row, { width: width * count }, rowStyle]}>
          {pages.map((page, pageIndex) => (
            <View key={pageIndex} style={[styles.page, { width }]}>
              {page}
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  window: {
    flex: 1,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    flex: 1,
  },
});
