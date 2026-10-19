import { FlashList, type FlashListProps } from '@shopify/flash-list';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  type ComponentType,
  type RefObject,
} from 'react';
import { View, type ScrollView, type ScrollViewProps } from 'react-native';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';

import { styles } from './styles';

import { GestureScrollView, useSheetScroll } from '@/components/ScrollSheet';
import { GridSkeleton } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

export type SheetListContextValue = {
  /** Высота прозрачной шапки — отсюда в содержимом начинается шит. */
  travel: number;
  /** Полоса с ручкой: под ней начинается первая строка сетки. */
  topBarHeight: number;
  animatedRef: AnimatedRef<ScrollView>;
  /** Ссылка для `simultaneousWithExternalGesture` жеста закрытия. */
  gestureRef: RefObject<ComponentType | null>;
  scrollOffset: SharedValue<number>;
  dismissing: SharedValue<boolean>;
  /** Скролл смонтирован и ссылка на него заполнена. */
  onScrollAttached: () => void;
  /** Скелет сетки галереи под клетками — только у раздела галереи. */
  skeleton: boolean;
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
  const { travel, topBarHeight, animatedRef, gestureRef, skeleton } = useSheetListContext();

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
        {skeleton ? (
          <GridSkeleton
            top={topBarHeight}
            square={theme.backgroundElement}
            gap={theme.background}
          />
        ) : null}
      </View>
      {children}
    </GestureScrollView>
  );
});

/**
 * Список шита для любого раздела: галереи, попсов и тех, что придут потом.
 * Им владеет движение шита — раздел только отдаёт ему строки.
 */
export function SheetList<T>(props: FlashListProps<T>) {
  const { animatedRef, scrollOffset, dismissing, onScrollAttached } = useSheetListContext();

  useSheetScroll(animatedRef, scrollOffset, dismissing);

  // Эффекты идут после того, как ссылки на скролл заполнены.
  useEffect(onScrollAttached, [onScrollAttached]);

  return (
    <FlashList
      {...props}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      renderScrollComponent={SheetScrollView}
    />
  );
}
