import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Сдвиг пальца по вертикали, с которого начинается листание. */
const ACTIVATE = 10;
/** Сдвиг по горизонтали, после которого это уже не листание: свайп влево ничего не делает. */
const FAIL_X = 20;
/** Доля высоты экрана или скорость броска (dp/с), после которых страница сменяется. */
const PAGE_SHARE = 0.18;
const FLING_VELOCITY = 600;
/** У края ленты страница идёт за пальцем туже. */
const EDGE_RESISTANCE = 0.3;
const SETTLE_MS = 220;

/**
 * Жест листания — для тех, кто внутри страницы должен его опередить:
 * прокрутка столбика реакций блокирует листание, пока палец в ней.
 */
export const PagerGestureContext = createContext<PanGesture | null>(null);

export type PopPagerProps<T> = {
  items: T[];
  activeIndex: number;
  width: number;
  height: number;
  onActiveIndex: (index: number) => void;
  keyOf: (item: T) => string;
  /** Страница — для активной, соседних и прогрева; остальных в дереве нет. */
  renderPage: (item: T, index: number) => ReactNode;
};

/**
 * Вертикальная лента страниц на весь экран, страница за свайп, как в TikTok.
 * Не нативная прокрутка: на Android ScrollView с играющим видео обрывал
 * второй и следующие свайпы на полпути. Здесь ход страницы — жест и анимация
 * на UI-потоке, а в дереве только активная страница и её соседи.
 */
export function PopPager<T>({
  items,
  activeIndex,
  width,
  height,
  onActiveIndex,
  keyOf,
  renderPage,
}: PopPagerProps<T>) {
  const index = useSharedValue(activeIndex);
  const offset = useSharedValue(-activeIndex * height);
  const count = useSharedValue(items.length);
  // Страница, которую React уже отрисовал активной. Пока он не догнал жест,
  // следующая страница не принимается: иначе быстрые свайпы уводят ленту за
  // смонтированных соседей, на пустой экран.
  const rendered = useSharedValue(activeIndex);

  // Индексы, на которые лента уже приехала жестом, а React ещё не догнал.
  // Активный индекс сменился не жестом (страницы подгрузились сверху, поп
  // пропал из ленты, сменилась высота) — лента переставляется на него сразу.
  // Положение ставится на UI-потоке: чтение shared value с JS-потока отстаёт,
  // и запоздалый эффект от прошлой страницы откатывал ленту назад.
  const fromGesture = useRef<number[]>([]);
  const placed = useRef({ at: activeIndex, height });

  useEffect(() => {
    const pending = fromGesture.current.indexOf(activeIndex);

    rendered.set(activeIndex);

    if (pending >= 0) {
      fromGesture.current = fromGesture.current.slice(pending + 1);
      placed.current = { at: activeIndex, height };
      return;
    }

    if (placed.current.at === activeIndex && placed.current.height === height) return;

    placed.current = { at: activeIndex, height };
    fromGesture.current = [];

    runOnUI(() => {
      index.set(activeIndex);
      offset.set(-activeIndex * height);
    })();
  }, [activeIndex, height, index, offset, rendered]);

  const reportIndex = useCallback(
    (next: number) => {
      fromGesture.current = [...fromGesture.current, next];
      onActiveIndex(next);
    },
    [onActiveIndex],
  );

  useEffect(() => {
    count.set(items.length);
  }, [count, items.length]);

  // `reportIndex` трогает ref, но зовётся по концу жеста, а не в рендере:
  // линтер видит передачу в ворклет внутри useMemo как чтение при рендере.
  /* eslint-disable react-hooks/refs */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-ACTIVATE, ACTIVATE])
        .failOffsetX([-FAIL_X, FAIL_X])
        .onUpdate((event) => {
          const at = index.get();
          const beyond =
            (at === 0 && event.translationY > 0) ||
            (at === count.get() - 1 && event.translationY < 0);
          const shift = beyond ? event.translationY * EDGE_RESISTANCE : event.translationY;

          offset.set(-at * height + shift);
        })
        .onEnd((event) => {
          const at = index.get();
          let next = at;

          if (event.translationY < -height * PAGE_SHARE || event.velocityY < -FLING_VELOCITY) {
            next = at + 1;
          } else if (event.translationY > height * PAGE_SHARE || event.velocityY > FLING_VELOCITY) {
            next = at - 1;
          }

          next = Math.min(Math.max(next, 0), count.get() - 1);

          if (at !== rendered.get()) next = at;
          index.set(next);
          offset.set(
            withTiming(-next * height, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) }),
          );

          // Страница становится активной сразу, пока доезжает: видео стартует без паузы.
          if (next !== at) runOnJS(reportIndex)(next);
        }),
    [count, height, index, offset, rendered, reportIndex],
  );
  /* eslint-enable react-hooks/refs */

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  const mounted = items
    .map((item, at) => ({ item, at }))
    .filter(({ at }) => at >= activeIndex - 1 && at <= activeIndex + 1);

  return (
    <PagerGestureContext.Provider value={pan}>
      <GestureDetector gesture={pan}>
        <View testID="pop-viewer-list" style={styles.clip}>
          <Animated.View style={[StyleSheet.absoluteFill, strip]}>
            {mounted.map(({ item, at }) => (
              <View key={keyOf(item)} style={[styles.page, { top: at * height, width, height }]}>
                {renderPage(item, at)}
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
    </PagerGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  clip: {
    flex: 1,
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    left: 0,
  },
});
