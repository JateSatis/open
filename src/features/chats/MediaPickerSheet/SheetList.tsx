import { FlashList } from '@shopify/flash-list';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  type ComponentProps,
  type ComponentType,
  type RefObject,
} from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { createNativeWrapper } from 'react-native-gesture-handler';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';

import { SHEET_TOP_HEIGHT, styles } from './styles';
import { useSheetScroll } from './useSheetScroll';

import { GridSkeleton, type MediaListComponent } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

/**
 * Скролл списка, про который жест закрытия знает, что с ним не спорит.
 *
 * `createNativeWrapper` вешает на `ScrollView` нативный жест RNGH и отдаёт
 * наружу сам `ScrollView` с проставленным `handlerTag` — одна и та же ссылка
 * годится и списку, и `simultaneousWithExternalGesture`.
 *
 * Не `GestureDetector` с `Gesture.Native()`: снаружи `FlashList` он цепляется
 * к вью-обёртке, а не к скроллу, и съедает скролл; вокруг самого `ScrollView`
 * он добавляет свою вью, и `FlashList` неверно считает положение содержимого.
 */
const GestureScrollView = createNativeWrapper<ScrollViewProps>(ScrollView, {
  disallowInterruption: false,
  shouldCancelWhenOutside: false,
});

export type SheetListContextValue = {
  /** Высота прозрачной шапки — отсюда в содержимом начинается шит. */
  travel: number;
  animatedRef: AnimatedRef<ScrollView>;
  /** Ссылка для `simultaneousWithExternalGesture` жеста закрытия. */
  gestureRef: RefObject<ComponentType | null>;
  scrollOffset: SharedValue<number>;
  dismissing: SharedValue<boolean>;
  /** Скролл смонтирован и ссылка на него заполнена. */
  onScrollAttached: () => void;
};

/**
 * Список объявлен на уровне модуля и получает всё, что ему нужно от шита,
 * через контекст. Будь он создан внутри шита, любое изменение зависимостей
 * (отступы, тема) давало бы `FlashList` новый тип скролл-компонента, и тот
 * пересоздавал бы нативный скролл вместе со всеми клетками.
 */
export const SheetListContext = createContext<SheetListContextValue | null>(null);

function useSheetListContext(): SheetListContextValue {
  const value = useContext(SheetListContext);

  if (!value) throw new Error('SheetMediaList рисуется только внутри MediaPickerSheet');

  return value;
}

/**
 * Подложка шита живёт **внутри содержимого списка**: её двигает тот же
 * нативный скролл, что и клетки, поэтому разъехаться со скруглённым верхом и
 * ручкой она не может. Скелет сетки — в ней же, в координатах содержимого.
 */
const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(
  { children, ...rest },
  ref,
) {
  const theme = useTheme();
  const { travel, animatedRef, gestureRef } = useSheetListContext();

  const attach = useCallback(
    (instance: ComponentType | null) => {
      gestureRef.current = instance;

      // RNGH описывает свой враппер как `ComponentType`, хотя наружу отдаёт
      // сам `ScrollView` со всеми его методами.
      const scrollView = instance as unknown as ScrollView | null;

      if (scrollView) animatedRef(scrollView);
      if (typeof ref === 'function') ref(scrollView);
      else if (ref) ref.current = scrollView;
    },
    [animatedRef, gestureRef, ref],
  );

  return (
    <GestureScrollView
      {...rest}
      ref={attach}
      // Список упирается в верх, и дальше палец тянет шит — растяжение
      // содержимого на Android и отскок на iOS спорили бы с ним за тот же
      // жест.
      overScrollMode="never"
      bounces={false}
    >
      <View
        style={[styles.surface, { top: travel, backgroundColor: theme.background }]}
        pointerEvents="none"
      >
        <GridSkeleton top={SHEET_TOP_HEIGHT} square={theme.backgroundElement} gap={theme.background} />
      </View>
      {children}
    </GestureScrollView>
  );
});

export const SheetMediaList: MediaListComponent = function SheetMediaList(
  props: ComponentProps<MediaListComponent>,
) {
  const { animatedRef, scrollOffset, dismissing, onScrollAttached } = useSheetListContext();

  useSheetScroll(animatedRef, scrollOffset, dismissing);

  // Эффекты идут после того, как ссылки на скролл заполнены.
  useEffect(onScrollAttached, [onScrollAttached]);

  return (
    <FlashList {...props} showsVerticalScrollIndicator={false} renderScrollComponent={SheetScrollView} />
  );
};
