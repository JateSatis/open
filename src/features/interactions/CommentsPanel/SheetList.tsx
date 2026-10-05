import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  type ComponentType,
  type Ref,
  type RefObject,
} from 'react';
import type { ScrollView, ScrollViewProps } from 'react-native';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';

import { GestureScrollView, useSheetScroll } from '@/components/ScrollSheet';

export type CommentsSheetContextValue = {
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

/** Скролл списка, связанный с жестом закрытия. */
const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(
  props,
  ref,
) {
  const { animatedRef, gestureRef } = useCommentsSheet();

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
      {...props}
      ref={attach}
      // Список упирается в верх, и дальше палец тянет шит — растяжение
      // содержимого на Android и отскок на iOS спорили бы с ним.
      overScrollMode="never"
      bounces={false}
      keyboardShouldPersistTaps="handled"
    />
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
