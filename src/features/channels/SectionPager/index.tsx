import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { dragPosition, resolveSection } from './pagerMath';

import { HorizontalGestureScope } from '@/components/HorizontalGestureScope';
import { Spacing } from '@/theme';

/** Сдвиг пальца по горизонтали, с которого жест узнаёт себя. */
const ACTIVATION_X = 16;
/** Вертикальный сдвиг раньше этого отдаёт касание прокрутке списка. */
const FAIL_Y = 12;
export const SECTION_SETTLE_MS = 260;
/** Полоса у левого края, где на iOS начинается свайп «назад». */
const IOS_BACK_EDGE = Platform.OS === 'ios' ? Spacing.four : 0;

export type SectionPagerProps = {
  /** Позиция в разделах: 0 — первый, 1 — второй, дробная — между ними. Её же читает контрол над пейджером. */
  position: SharedValue<number>;
  width: number;
  pages: ReactNode[];
  /** Выбранный раздел — там, где ряд стоит в покое. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Палец начал листать разделы — например, чтобы подровнять соседние. */
  onDragStart?: () => void;
  /** Жест над пейджером, которому свайп достаётся первым (тянуть страницу назад). */
  waitFor?: GestureType;
};

/**
 * Разделы бок о бок, листаются свайпом. Жест горизонтальный и уступает
 * вертикальной прокрутке. Касание у самого левого края на iOS пейджер не
 * берёт: оттуда начинается системное «назад».
 *
 * Полноэкранный просмотр, шиты и меню — отдельные окна (`Modal`): касания в
 * них сюда не доходят, и пейджер под ними не листается.
 */
export function SectionPager({
  position,
  width,
  pages,
  index,
  onIndexChange,
  onDragStart,
  waitFor,
}: SectionPagerProps) {
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const count = pages.length;
  // Раздел, где ряд стоит в покое, — отстаёт от выбранного на время доводки:
  // обычный стиль меняется, только когда анимация уже пришла туда же, и
  // нативный коммит не обгоняет её на кадр.
  const [resting, setResting] = useState(index);

  useEffect(() => {
    const timer = setTimeout(() => setResting(index), SECTION_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [index]);

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .activeOffsetX([-ACTIVATION_X, ACTIVATION_X])
      // Край экрана слева на iOS — системное «назад»: пейджер его не берёт.
      .hitSlop({ left: -IOS_BACK_EDGE })
      .failOffsetY([-FAIL_Y, FAIL_Y])
      // С момента, как жест узнал себя: простое касание поста не трогает
      // докатывающуюся после тапа по контролу позицию.
      .onStart(() => {
        cancelAnimation(position);
        start.set(position.get());
        dragging.set(true);
        if (onDragStart) runOnJS(onDragStart)();
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
      });

    return waitFor ? gesture.requireExternalGestureToFail(waitFor) : gesture;
  }, [count, dragging, onDragStart, onIndexChange, position, start, waitFor, width]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -position.get() * width }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View testID="section-pager" style={styles.window}>
        {/* Сдвиг ряда ведёт Reanimated, но сдвиг в покое — ещё и в обычном
            стиле, последним: когда поверх открывается нативное окно (меню
            «⋮»), Android заново применяет к ряду свойства из дерева React, и
            без него ряд возвращался к сдвигу на момент монтирования. */}
        <Animated.View
          style={[
            styles.row,
            rowStyle,
            { width: width * count, transform: [{ translateX: -resting * width }] },
          ]}
        >
          {/* Полоса, прокручиваемая вбок (реакции в облачке), разделы не листает. */}
          <HorizontalGestureScope gesture={pan}>
            {pages.map((page, pageIndex) => (
              <View key={pageIndex} style={[styles.page, { width }]}>
                {page}
              </View>
            ))}
          </HorizontalGestureScope>
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
