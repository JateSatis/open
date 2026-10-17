import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type ScrollViewProps,
} from 'react-native';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
  runOnJS,
  type AnimatedRef,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInfoScroll } from './scroll';

/** Скорость отпускания, ниже которой инерции не будет и доводка — сразу. */
const STILL_VELOCITY = 0.05;
/** Сколько ждать начала инерции после отпускания, прежде чем доводить без неё. */
const MOMENTUM_WAIT_MS = 120;

const ListRefContext = createContext<AnimatedRef<Animated.ScrollView> | null>(null);

/**
 * Скролл списка вкладки: тот же нативный `ScrollView`, но со ссылкой
 * Reanimated — по ней смещение читается и правится на UI-потоке, без
 * `onScroll` через JS. Объявлен на уровне модуля: новый тип скролла
 * `FlashList` пересоздавал бы вместе со всеми клетками.
 */
const TabScrollView = forwardRef<ScrollView, ScrollViewProps>(function TabScrollView(props, ref) {
  const animatedRef = useContext(ListRefContext);

  const attach = useCallback(
    (instance: Animated.ScrollView | null) => {
      if (instance) animatedRef?.(instance);

      const scrollView = instance as unknown as ScrollView | null;

      if (typeof ref === 'function') ref(scrollView);
      else if (ref) ref.current = scrollView;
    },
    [animatedRef, ref],
  );

  return (
    <Animated.ScrollView
      {...props}
      ref={attach}
      // Растяжение края на Android спорило бы с раскрытием фото.
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
    />
  );
});

export type InfoTabListProps<T> = Omit<
  FlashListProps<T>,
  'renderScrollComponent' | 'ListHeaderComponent' | 'ListFooterComponent' | 'ref'
> & {
  /** Номер вкладки на странице. */
  tab: number;
  /** Под строками: подгрузка, ошибка с повтором. */
  footer?: ReactElement | null;
};

/**
 * Список вкладки страницы информации. Сверху — прозрачное место под шапку
 * страницы, снизу — добор высоты, чтобы и короткая вкладка могла довести
 * полосу вкладок до прилипания. Смещение списка ведёт шапку, пока вкладка
 * активна.
 */
export function InfoTabList<T>({ tab, footer, ...props }: InfoTabListProps<T>) {
  const scroll = useInfoScroll();
  const { geometry, listTop, stickY, viewportHeight } = scroll;
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlashListRef<T>>(null);
  const animatedRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(animatedRef);
  const [initialY] = useState(scroll.initialOffset);
  // Список встаёт на своё начальное смещение только когда содержимого уже
  // хватает: раньше нативный скролл обрезал бы его до нуля, и шапка
  // мелькнула бы раскрытым фото. До того список не виден и шапку не ведёт.
  const positioned = useSharedValue(initialY === 0);
  const [shown, setShown] = useState(initialY === 0);
  const [contentHeight, setContentHeight] = useState(0);
  const momentum = useRef(false);

  const { register } = scroll;

  useEffect(
    () =>
      register(tab, {
        offset,
        scrollTo: (y, animated) => listRef.current?.scrollToOffset({ offset: y, animated }),
      }),
    [offset, register, tab],
  );

  const { scrollY, activeTab, dragging, expanded, onThreshold } = scroll;
  const { expand, expandThreshold } = geometry;

  // Активная вкладка ведёт шапку. Инерция, долетевшая до верха, раскрывать
  // фото не должна: раскрытие — только пальцем.
  useAnimatedReaction(
    () => offset.value,
    (y, previous) => {
      if (activeTab.value !== tab || !positioned.value) return;

      scrollY.set(y);

      if (expand <= 0) return;

      if (y <= 0.5) expanded.set(true);
      else if (y >= expand) expanded.set(false);

      if (
        !dragging.value &&
        !expanded.value &&
        y < expand &&
        previous !== null &&
        previous >= expand
      ) {
        scrollTo(animatedRef, 0, expand, false);
        return;
      }

      const mark = expand - expandThreshold;

      if (dragging.value && previous !== null && previous > mark && y <= mark) {
        runOnJS(onThreshold)();
      }
    },
  );

  const { onSettle, onDragStart } = scroll;

  // Инерция обещана, но не началась (на Android у самого края так бывает) —
  // довести всё равно, иначе шапка осталась бы посередине.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const onScrollBeginDrag = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    momentum.current = false;
    dragging.set(true);
    onDragStart();
  }, [dragging, onDragStart]);

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      dragging.set(false);
      const velocity = event.nativeEvent.velocity?.y ?? 0;

      // С инерцией — довести, когда она кончится.
      if (Math.abs(velocity) > STILL_VELOCITY) {
        settleTimer.current = setTimeout(() => {
          if (!momentum.current) onSettle(tab, offset.value);
        }, MOMENTUM_WAIT_MS);
        return;
      }

      onSettle(tab, event.nativeEvent.contentOffset.y);
    },
    [dragging, offset, onSettle, tab],
  );

  const onMomentumScrollBegin = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    momentum.current = true;
  }, []);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!momentum.current) return;

      momentum.current = false;
      onSettle(tab, event.nativeEvent.contentOffset.y);
    },
    [onSettle, tab],
  );

  // Короткой вкладке не хватит высоты довести полосу до прилипания: добираем
  // пустотой снизу. `contentHeight` — место под шапку и строки, без добора.
  const filler = Math.max(0, stickY + viewportHeight - contentHeight);
  const header = useMemo(() => <View style={{ height: listTop }} />, [listTop]);
  const tail = useMemo(
    () => (
      <View>
        {footer}
        {/* Список доходит до края окна: низ — над полосой навигации. */}
        <View style={{ height: insets.bottom + filler }} />
      </View>
    ),
    [filler, footer, insets.bottom],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      setContentHeight(height - filler);

      if (shown || height < initialY + viewportHeight) return;

      listRef.current?.scrollToOffset({ offset: initialY, animated: false });
      requestAnimationFrame(() => {
        positioned.set(true);
        setShown(true);
      });
    },
    [filler, initialY, positioned, shown, viewportHeight],
  );

  return (
    <ListRefContext.Provider value={animatedRef}>
      <View style={[styles.fill, !shown && styles.hidden]}>
        <FlashList
          {...props}
          ref={listRef}
          renderScrollComponent={TabScrollView}
          ListHeaderComponent={header}
          ListFooterComponent={tail}
          onContentSizeChange={onContentSizeChange}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onMomentumScrollEnd}
        />
      </View>
    </ListRefContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  hidden: {
    opacity: 0,
  },
});
