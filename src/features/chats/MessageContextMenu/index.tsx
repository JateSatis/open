import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeMenuLayout } from './menuLayout';
import { styles } from './styles';

import { Text } from '@/components/Text';
import type { MessageAction, MessageActionId } from '@/features/chats/messageActions';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

const OPEN_MS = 200;
const CLOSE_MS = 140;

/** Прямоугольник облачка в координатах окна — где оно стоит в переписке. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

export type MessageContextMenuProps = {
  /** Меню открыто, пока есть, над чем. */
  anchor: AnchorRect | null;
  /** Копия облачка, которая поднимается над затемнением. */
  preview: ReactNode;
  actions: MessageAction[];
  /** Своё сообщение — меню у правого края облачка, чужое — у левого. */
  alignEnd: boolean;
  /** Отступ облачка от левого края строки (аватар у чужих) — меню встаёт под облачко, а не под аватар. */
  leadingInset: number;
  /** Действие выполняется после того, как меню закрылось: диалог подтверждения не ложится поверх меню. */
  onAction: (id: MessageActionId) => void;
  onClose: () => void;
};

/**
 * Меню долгого нажатия на сообщение. Своё окно (`Modal`) — единственный
 * способ затемнить и нативный заголовок, и нативный таб-бар (см. заметку про
 * шит медиа). Облачко поднимается над затемнением, под ним — список действий;
 * над ним оставлено место для блока реакций.
 */
export function MessageContextMenu({
  anchor,
  preview,
  actions,
  alignEnd,
  leadingInset,
  onAction,
  onClose,
}: MessageContextMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const pendingRef = useRef<MessageActionId | null>(null);

  const menuHeight = actions.length * Sizes.menuRowHeight + Spacing.one * 2;
  const layout = anchor
    ? computeMenuLayout({
        anchorTop: anchor.y,
        anchorHeight: anchor.height,
        menuHeight,
        accessoryHeight: 0,
        windowHeight,
        safeTop: insets.top,
        safeBottom: insets.bottom,
        margin: Spacing.two,
        gap: Spacing.two,
      })
    : null;
  const shift = anchor && layout ? anchor.y - layout.bubbleTop : 0;

  useEffect(() => {
    if (!anchor) return;

    closingRef.current = false;
    pendingRef.current = null;
    progress.set(0);
    progress.set(withTiming(1, { duration: OPEN_MS }));
  }, [anchor, progress]);

  const finish = useCallback(() => {
    const action = pendingRef.current;

    pendingRef.current = null;
    onClose();

    // Действие — следующим кадром, отдельным от закрытия проходом. Иначе
    // окно меню исчезло бы только вместе с тем, что делает действие (вход в
    // выбор перерисовывает весь список), и касания, сделанные сразу после
    // выбора пункта, уходили бы в ещё не закрытое окно.
    if (action) requestAnimationFrame(() => onAction(action));
  }, [onAction, onClose]);

  const close = useCallback(
    (action: MessageActionId | null) => {
      if (closingRef.current) return;

      closingRef.current = true;
      pendingRef.current = action;
      progress.set(
        withTiming(0, { duration: CLOSE_MS }, (finished) => {
          if (finished) runOnJS(finish)();
        }),
      );
    },
    [finish, progress],
  );

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Облачко выезжает из того места, где стояло в переписке.
  const previewStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * shift }],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  const horizontal = anchor
    ? alignEnd
      ? { right: Math.max(Spacing.two, windowWidth - anchor.x - anchor.width) }
      : { left: anchor.x + leadingInset }
    : null;

  return (
    <Modal
      visible={anchor !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={() => close(null)}
    >
      {anchor && layout ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }, backdropStyle]}
          >
            <Pressable
              testID="message-menu-backdrop"
              accessibilityLabel="Закрыть меню"
              style={StyleSheet.absoluteFill}
              onPress={() => close(null)}
            />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.preview,
              {
                top: layout.bubbleTop,
                left: anchor.x,
                width: anchor.width,
                height: layout.bubbleHeight,
              },
              previewStyle,
            ]}
          >
            {preview}
          </Animated.View>

          <Animated.View
            testID="message-menu"
            style={[
              styles.menu,
              { top: layout.menuTop, backgroundColor: theme.backgroundElement },
              alignEnd ? styles.originEnd : styles.originStart,
              horizontal,
              menuStyle,
            ]}
          >
            {actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="menuitem"
                accessibilityLabel={action.label}
                onPress={() => close(action.id)}
                style={({ pressed }) => [
                  styles.item,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <Text color={action.destructive ? 'danger' : 'text'}>{action.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}
