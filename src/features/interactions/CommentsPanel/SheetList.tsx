import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  type ComponentType,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { View, type ScrollView, type ScrollViewProps } from 'react-native';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';

import { styles } from './styles';

import { GestureScrollView, useSheetScroll } from '@/components/ScrollSheet';
import { useTheme } from '@/hooks/use-theme';

export type CommentsSheetContextValue = {
  /** Ход шита — высота прозрачного начала содержимого: отсюда начинается подложка. */
  travel: number;
  animatedRef: AnimatedRef<ScrollView>;
  /** Ссылка для `simultaneousWithExternalGesture` жеста закрытия. */
  gestureRef: RefObject<ComponentType | null>;
  scrollOffset: SharedValue<number>;
  dismissing: SharedValue<boolean>;
  /** Скролл смонтирован и ссылка на него заполнена. */
  onScrollAttached: () => void;
  /**
   * Слои поверх строк, в координатах содержимого: шапка шита и липкий корень
   * треда. Они в содержимом, а не над списком, — касание по ним достаётся
   * тому же нативному скроллу, и шит за шапку тянется так же, как за список.
   */
  overlay: ReactNode;
};

/**
 * Список объявлен на уровне модуля и получает всё, что ему нужно от шита,
 * через контекст: созданный внутри панели скролл-компонент менялся бы на
 * каждом рендере, и `FlashList` пересоздавал бы нативный скролл со всеми
 * строками (см. шит медиа).
 */
export const CommentsSheetContext = createContext<CommentsSheetContextValue | null>(null);

function useCommentsSheet(): CommentsSheetContextValue {
  const value = useContext(CommentsSheetContext);

  if (!value) throw new Error('CommentsSheetList рисуется только внутри панели комментариев');

  return value;
}

/**
 * Подложка шита живёт внутри содержимого списка — её двигает тот же
 * нативный скролл, что и строки, поэтому подъём шита и есть скролл, как в
 * шите медиа. Шапка и липкий корень — после строк, чтобы рисоваться поверх.
 */
const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(
  { children, ...rest },
  ref,
) {
  const theme = useTheme();
  const { travel, animatedRef, gestureRef, overlay } = useCommentsSheet();

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
      // содержимого на Android и отскок на iOS спорили бы с ним.
      overScrollMode="never"
      bounces={false}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[styles.surface, { top: travel, backgroundColor: theme.background }]}
        pointerEvents="none"
      />
      {children}
      {overlay}
    </GestureScrollView>
  );
});

export type CommentsSheetListProps<T> = Omit<FlashListProps<T>, 'renderScrollComponent'> & {
  listRef: Ref<FlashListRef<T>>;
};

/** Список комментариев внутри шита: позиция скролла — на UI-потоке, для жеста и шапки. */
export function CommentsSheetList<T>({ listRef, ...props }: CommentsSheetListProps<T>) {
  const { animatedRef, scrollOffset, dismissing, onScrollAttached } = useCommentsSheet();

  useSheetScroll(animatedRef, scrollOffset, dismissing);

  // Эффекты идут после того, как ссылки на скролл заполнены.
  useEffect(onScrollAttached, [onScrollAttached]);

  return (
    <FlashList
      {...props}
      ref={listRef}
      showsVerticalScrollIndicator={false}
      renderScrollComponent={SheetScrollView}
    />
  );
}
