import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useIsLifted } from './liftedStore';
import { styles } from './styles';

import { Text } from '@/components/Text';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { useTheme } from '@/hooks/use-theme';

/**
 * Размеры строк по id сообщения — вне React и вне shared value: нужны только
 * в момент долгого нажатия, а shared value, прочитанное из замыкания жеста,
 * Reanimated засчитывает как чтение во время рендера каждой строки.
 */
const rowSizes = new Map<string, { width: number; height: number }>();

/** Столько держать палец, чтобы открылось меню. */
const LONG_PRESS_MS = 350;
/** Подсветка сообщения, к которому прыгнули: вспыхивает, когда прокрутка доехала, держится секунду. */
const HIGHLIGHT_DELAY_MS = 300;
const HIGHLIGHT_IN_MS = 150;
const HIGHLIGHT_HOLD_MS = 1000;
const HIGHLIGHT_FADE_MS = 400;

export type MessageRowProps = {
  children: ReactNode;
  /** Режим выбора: тап отмечает, а не открывает. */
  selectionMode: boolean;
  /** Сообщение можно отметить (неотправленное — нельзя). */
  selectable: boolean;
  selected: boolean;
  /** Меняется при каждом прыжке к сообщению — подсветка вспыхивает заново. */
  highlightKey: number | null;
  /** Над строкой может быть открыто меню: её копия поднята над затемнением, а сама строка прячется. */
  messageId: string;
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
  messageId,
  onLongPress,
  onToggle,
}: MessageRowProps) {
  const theme = useTheme();
  const highlight = useSharedValue(0);
  const lifted = useIsLifted(messageId);

  useEffect(() => () => void rowSizes.delete(messageId), [messageId]);

  useEffect(() => {
    if (highlightKey === null) return;

    highlight.set(
      withDelay(
        HIGHLIGHT_DELAY_MS,
        withSequence(
          withTiming(1, { duration: HIGHLIGHT_IN_MS }),
          withDelay(HIGHLIGHT_HOLD_MS, withTiming(0, { duration: HIGHLIGHT_FADE_MS })),
        ),
      ),
    );
  }, [highlight, highlightKey]);

  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.value }));

  const openMenu = useCallback(
    (x: number, y: number) => {
      // Раскладка всегда случается раньше касания; нулевой размер — только
      // страховка, чтобы меню открылось, даже если её не было.
      onLongPress({ x, y, ...(rowSizes.get(messageId) ?? { width: 0, height: 0 }) });
    },
    [messageId, onLongPress],
  );

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LONG_PRESS_MS)
        .enabled(!selectionMode)
        .withTestId(`message-long-press-${messageId}`)
        .onStart((event) => {
          // Точка касания известна и в окне, и внутри строки — их разность и
          // есть угол строки в окне, без отдельного замера.
          runOnJS(openMenu)(event.absoluteX - event.x, event.absoluteY - event.y);
        }),
    [messageId, openMenu, selectionMode],
  );

  // Дерево строки одно и то же в обоих режимах: переключение выбора меняет
  // лишь кружок и то, кому достаются касания. Иначе вход в выбор пересоздавал
  // бы каждое облачко в списке — с картинками и плеерами, — и первые касания
  // после него тонули бы, пока список пересобирается.
  return (
    <View style={styles.row}>
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: theme.messageHighlight }, highlightStyle]}
      />

      {selected ? (
        <View
          pointerEvents="none"
          style={[styles.fill, { backgroundColor: theme.messageHighlight }]}
        />
      ) : null}

      <GestureDetector gesture={longPress}>
        <View collapsable={false}>
          <Pressable
            accessibilityRole={selectionMode ? 'checkbox' : undefined}
            accessibilityState={selectionMode ? { checked: selected, disabled: !selectable } : undefined}
            accessibilityLabel={
              selectionMode ? (selected ? 'Снять отметку' : 'Отметить сообщение') : undefined
            }
            accessible={selectionMode}
            disabled={!selectionMode || !selectable}
            onPress={onToggle}
            style={styles.selectable}
          >
            {selectionMode ? (
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
            ) : null}

            {/* В режиме выбора облачко не живёт своей жизнью: тап не открывает
                просмотрщик, не запускает голосовое и не ведёт в профиль. */}
            <View
              pointerEvents={selectionMode ? 'none' : 'auto'}
              style={[styles.content, lifted && styles.lifted]}
              onLayout={({ nativeEvent }) =>
                rowSizes.set(messageId, {
                  width: nativeEvent.layout.width,
                  height: nativeEvent.layout.height,
                })
              }
            >
              {children}
            </View>
          </Pressable>
        </View>
      </GestureDetector>
    </View>
  );
}
