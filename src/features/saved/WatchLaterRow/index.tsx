import { SymbolView } from 'expo-symbols';
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { memo, useCallback, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS } from 'react-native-reanimated';

import { styles } from './styles';
import { useSwipeRemove } from './useSwipeRemove';
import { WatchLaterRowBody, type WatchLaterRowBodyProps } from './WatchLaterRowBody';

import type { SavedMessage } from '@/api/saved';
import { HorizontalGestureScope } from '@/components/HorizontalGestureScope';
import type { MenuAnchor } from '@/features/chats/MessageContextMenu';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export { WatchLaterRowBody } from './WatchLaterRowBody';

/** Столько держать палец, чтобы открылось меню, — как у сообщения. */
const LONG_PRESS_MS = 350;

export type WatchLaterRowProps = Omit<
  WatchLaterRowBodyProps,
  'onToggleExpanded' | 'onToggleDone'
> & {
  onToggleExpanded: (saved: SavedMessage) => void;
  onToggleDone: (saved: SavedMessage) => void;
  /** Свайп влево за порог: строка уехала — убрать её из вкладки. */
  onRemove: (saved: SavedMessage) => void;
  onOpenMenu: (saved: SavedMessage, anchor: MenuAnchor) => void;
};

/**
 * Строка «Посмотреть позже» с жестами: тап по шапке раскрывает и
 * сворачивает, долгое нажатие (и на раскрытом пузыре) — меню, свайп влево
 * убирает строку из вкладки.
 */
export const WatchLaterRow = memo(function WatchLaterRow({
  onToggleExpanded,
  onToggleDone,
  onRemove,
  onOpenMenu,
  ...body
}: WatchLaterRowProps) {
  const theme = useTheme();
  const { saved } = body;
  const rowRef = useRef<View>(null);
  const remove = useCallback(() => onRemove(saved), [onRemove, saved]);
  const swipe = useSwipeRemove(saved.id, remove);

  const openMenu = useCallback(
    (touchY: number) => {
      impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
      rowRef.current?.measureInWindow((x, y, width, height) =>
        onOpenMenu(saved, { x, y, width, height, touchY }),
      );
    },
    [onOpenMenu, saved],
  );

  // Долгое нажатие узнаёт себя после удержания: сдвиг раньше — отказ, и
  // касание достаётся свайпу или прокрутке.
  const gesture = useMemo(
    () =>
      Gesture.Race(
        swipe.gesture,
        Gesture.LongPress()
          .minDuration(LONG_PRESS_MS)
          .withTestId(`watch-later-long-press-${saved.id}`)
          .onStart((event) => {
            runOnJS(openMenu)(event.absoluteY);
          }),
      ),
    [openMenu, saved.id, swipe.gesture],
  );

  return (
    <View style={styles.cell}>
      <Animated.View pointerEvents="none" style={[styles.removeIcon, swipe.iconStyle]}>
        <View style={[styles.removeCircle, { backgroundColor: theme.danger }]}>
          <SymbolView
            name={{ ios: 'trash', android: 'delete', web: 'delete' }}
            size={Sizes.swipeRemoveIcon}
            tintColor={theme.primaryText}
          />
        </View>
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          style={[{ backgroundColor: theme.background }, swipe.contentStyle]}
        >
          <WatchLaterRowBody
            ref={rowRef}
            {...body}
            onToggleExpanded={() => onToggleExpanded(saved)}
            onToggleDone={() => onToggleDone(saved)}
            wrapBubble={(bubble) => (
              <HorizontalGestureScope gesture={swipe.gesture}>{bubble}</HorizontalGestureScope>
            )}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
});
