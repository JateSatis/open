// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useRef, useState, type ComponentType } from 'react';
import { Modal, Pressable, useWindowDimensions, type ScrollView } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterContent } from './FilterContent';
import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import {
  CLOSE_DURATION_MS,
  GestureScrollView,
  OPEN_SPRING,
  useDismissGesture,
  useSheetScroll,
} from '@/components/ScrollSheet';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useSavedFilters } from '@/features/saved/savedFiltersStore';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Отпущенный дальше этой доли своей высоты лист закрывается. */
const DISMISS_FRACTION = 0.25;

export type SavedFilterSheetProps = {
  tags: SavedTag[];
  onClose: () => void;
};

/**
 * Лист фильтров «Сохранённых» снизу. Своё окно (`Modal`): шапка экрана и
 * таб-бар нативные, оверлей их не перекроет (см. шит медиа). Закрывается
 * свайпом вниз (список докручивается до верха, дальше палец тянет лист),
 * тапом мимо и системным «назад».
 */
export function SavedFilterSheet({ tags, onClose }: SavedFilterSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const filters = useSavedFilters();
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  const [scrollAttached, setScrollAttached] = useState(false);
  const dismissY = useSharedValue(windowHeight);
  const dismissing = useSharedValue(false);
  const scrollOffset = useSharedValue(0);
  const animatedRef = useAnimatedRef<ScrollView>();
  const gestureRef = useRef<ComponentType | null>(null);

  const close = useCallback(() => {
    dismissY.value = withTiming(windowHeight, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [dismissY, onClose, windowHeight]);

  const pan = useDismissGesture({
    dismissY,
    scrollOffset,
    dismissing,
    scrollGestureRef: gestureRef,
    scrollAttached,
    dismissDistance: sheetHeight * DISMISS_FRACTION,
    onRelease: close,
    testId: 'saved-filter-sheet-pan',
  });

  useSheetScroll(animatedRef, scrollOffset, dismissing);

  const attach = useCallback(
    (instance: ComponentType | null) => {
      gestureRef.current = instance;
      // RNGH описывает враппер как `ComponentType`, хотя отдаёт сам `ScrollView`.
      const scrollView = instance as unknown as ScrollView | null;

      if (scrollView) {
        animatedRef(scrollView);
        setScrollAttached(true);
      }
    },
    [animatedRef],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dismissY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(1 - dismissY.value / Math.max(sheetHeight, 1), 0), 1),
  }));

  return (
    <Modal
      testID="saved-filter-sheet"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={() => {
        dismissY.value = withSpring(0, OPEN_SPRING);
      }}
    >
      {/* Своё окно на Android — свой корень жестов. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.fill, { backgroundColor: theme.overlay }, backdropStyle]}>
          <Pressable
            testID="saved-filter-backdrop"
            accessibilityLabel="Закрыть фильтры"
            style={styles.fill}
            onPress={close}
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            style={[styles.sheet, { backgroundColor: theme.background }, sheetStyle]}
          >
            <Animated.View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <GestureScrollView
              ref={attach}
              overScrollMode="never"
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.three) }}
            >
              <FilterContent filters={filters} tags={tags} />
            </GestureScrollView>
          </Animated.View>
        </GestureDetector>

        <InAppNoticeToast />
      </GestureHandlerRootView>
    </Modal>
  );
}
