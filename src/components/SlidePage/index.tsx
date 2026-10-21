import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { SlidePageContext } from './context';
import type { SlideBack } from './useSlideBack';

import { HorizontalGestureScope } from '@/components/HorizontalGestureScope';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageOpacity } from '@/theme';

export {
  SlidePageHeader,
  useSlidePage,
  useSlidePageBack,
  useSlidePageLeaveGuard,
  useSlidePageSwipeStart,
} from './context';
export { useSlideBack, type LeaveGuard, type SlideBack } from './useSlideBack';

export type SlidePageProps = {
  /** Въезд и уход — из `useSlideBack` у владельца маршрута: ему тоже бывает нужно уйти. */
  slide: SlideBack;
  /**
   * Свой свайп страницы (`slide.makeSwipe` с условием) — когда кому-то внутри
   * надо его ждать: пейджер «Посты / Попсы» листает назад, пока он не на
   * первом разделе. Нет — страницу можно тянуть всегда.
   */
  swipe?: GestureType;
  children: ReactNode;
  testID?: string;
};

/**
 * Экран-страница: въезжает справа, уезжает свайпом вправо из любого места
 * за пальцем, под ней виден предыдущий экран (маршрут открыт прозрачным,
 * `transparentModal` без анимации стека). Шапку кладёт содержимое
 * (`SlidePageHeader`) — она уезжает вместе со страницей.
 *
 * Свайп уступает тем, кому горизонталь нужнее: ряды реакций, перемотка и
 * запись голосового, выделение текста ждут его через `HorizontalGestureScope`
 * (а он — их), вертикальная прокрутка гасит его на первых пикселях. Начало
 * свайпа убирает клавиатуру.
 */
export function SlidePage({ slide, swipe, children, testID }: SlidePageProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const always = useSharedValue(true);
  const { makeSwipe, offset, onSwipeStart } = slide;
  const gesture = useMemo(() => swipe ?? makeSwipe(always), [always, makeSwipe, swipe]);
  const [header, setHeader] = useState<ReactNode>(null);

  useEffect(() => onSwipeStart(() => Keyboard.dismiss()), [onSwipeStart]);

  const context = useMemo(() => ({ slide, setHeader }), [slide]);

  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: InfoPageOpacity.backdrop * (1 - Math.min(1, Math.max(0, offset.value / width))),
  }));

  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }, backdropStyle]}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.page, { backgroundColor: theme.background }, pageStyle]}>
          <SlidePageContext.Provider value={context}>
            <HorizontalGestureScope gesture={gesture}>
              {header}
              <View style={styles.page}>{children}</View>
            </HorizontalGestureScope>
          </SlidePageContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: 'hidden',
  },
});
