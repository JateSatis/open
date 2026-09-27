import { useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { useTheme } from '@/hooks/use-theme';

/** Столько держать палец, чтобы открылось меню. */
const LONG_PRESS_MS = 350;
/** Подсветка сообщения, к которому прыгнули. */
const HIGHLIGHT_HOLD_MS = 700;
const HIGHLIGHT_FADE_MS = 300;

export type MessageRowProps = {
  children: ReactNode;
  /** Режим выбора: тап отмечает, а не открывает. */
  selectionMode: boolean;
  /** Сообщение можно отметить (неотправленное — нельзя). */
  selectable: boolean;
  selected: boolean;
  /** Меняется при каждом прыжке к сообщению — подсветка вспыхивает заново. */
  highlightKey: number | null;
  /** Над строкой открыто меню: её копия поднята над затемнением, а сама строка прячется. */
  lifted: boolean;
  onLongPress: (anchor: AnchorRect) => void;
  onToggle: () => void;
};

/**
 * Строка переписки вокруг облачка: долгое нажатие открывает меню, в режиме
 * выбора слева появляется кружок, а тап по строке отмечает сообщение.
 *
 * Долгое нажатие ловит жест-обработчик, а не `Pressable`: так оно работает
 * на любом облачке, не мешая тому, что внутри, — плитке альбома, перемотке
 * голосового по волне (сдвиг пальца отменяет долгое нажатие), имени автора.
 */
export function MessageRow({
  children,
  selectionMode,
  selectable,
  selected,
  highlightKey,
  lifted,
  onLongPress,
  onToggle,
}: MessageRowProps) {
  const theme = useTheme();
  const size = useSharedValue({ width: 0, height: 0 });
  const highlight = useSharedValue(0);

  useEffect(() => {
    if (highlightKey === null) return;

    highlight.set(1);
    highlight.set(withDelay(HIGHLIGHT_HOLD_MS, withTiming(0, { duration: HIGHLIGHT_FADE_MS })));
  }, [highlight, highlightKey]);

  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.value }));

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LONG_PRESS_MS)
        .enabled(!selectionMode)
        .onStart((event) => {
          // Точка касания известна и в окне, и внутри строки — их разность и
          // есть угол строки в окне, без отдельного замера.
          runOnJS(onLongPress)({
            x: event.absoluteX - event.x,
            y: event.absoluteY - event.y,
            width: size.value.width,
            height: size.value.height,
          });
        }),
    [onLongPress, selectionMode, size],
  );

  const content = (
    <View
      collapsable={false}
      style={[styles.content, lifted && styles.lifted]}
      onLayout={({ nativeEvent }) =>
        size.set({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
      }
    >
      {children}
    </View>
  );

  return (
    <View style={styles.row}>
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: theme.messageHighlight }, highlightStyle]}
      />

      {selectionMode ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, disabled: !selectable }}
          accessibilityLabel={selected ? 'Снять отметку' : 'Отметить сообщение'}
          disabled={!selectable}
          onPress={onToggle}
          style={[styles.selectable, selected && { backgroundColor: theme.messageHighlight }]}
        >
          <View
            style={[
              styles.mark,
              { borderColor: selected ? theme.primary : theme.textSecondary },
              selected && { backgroundColor: theme.primary },
              !selectable && styles.markHidden,
            ]}
          >
            {selected ? (
              <Text variant="caption" color="primaryText">
                ✓
              </Text>
            ) : null}
          </View>

          {/* В режиме выбора облачко не живёт своей жизнью: тап не открывает
              просмотрщик, не запускает голосовое и не ведёт в профиль. */}
          <View pointerEvents="none" style={styles.content}>
            {children}
          </View>
        </Pressable>
      ) : (
        <GestureDetector gesture={longPress}>{content}</GestureDetector>
      )}
    </View>
  );
}
