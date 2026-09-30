import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

const OPEN_MS = 200;
const CLOSE_MS = 140;

/** Прямоугольник облачка в координатах окна — где оно стоит в переписке. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

/** Блок реакций над облачком. Один и тот же у участника и у посетителя. */
export type MenuReactions = {
  /** Моя реакция на это сообщение — подсвечена; тап по ней снимает. */
  selected: string | null;
  /** Реакция ставится после того, как меню закрылось, — как и действие. */
  onSelect: (emoji: string) => void;
};

/** Пункт меню. Меню одно на сообщения и комментарии — пункты у них свои. */
export type ContextMenuAction<Id extends string = string> = {
  id: Id;
  label: string;
  /** Красным — разрушительное действие. */
  destructive?: boolean;
};

export type MessageContextMenuProps<Id extends string = string> = {
  /** Меню открыто, пока есть, над чем. */
  anchor: AnchorRect | null;
  /** Копия облачка, которая поднимается над затемнением. */
  preview: ReactNode;
  actions: readonly ContextMenuAction<Id>[];
  /** Нет — нет и блока реакций: у неотправленного и у системного сообщения. */
  reactions: MenuReactions | null;
  /** Своё сообщение — меню у правого края облачка, чужое — у левого. */
  alignEnd: boolean;
  /** Отступ облачка от левого края строки (аватар у чужих) — меню встаёт под облачко, а не под аватар. */
  leadingInset: number;
  /** Действие выполняется после того, как меню закрылось: диалог подтверждения не ложится поверх меню. */
  onAction: (id: Id) => void;
  onClose: () => void;
};

/**
 * Меню долгого нажатия на сообщение. Своё окно (`Modal`) — единственный
 * способ затемнить и нативный заголовок, и нативный таб-бар (см. заметку про
 * шит медиа). Облачко поднимается над затемнением, под ним — список действий,
 * над ним — блок реакций. Раскрытый блок растёт вниз, поверх облачка, до края
 * экрана; действия на это время прячутся.
 */
export function MessageContextMenu<Id extends string>({
  anchor,
  preview,
  actions,
  reactions,
  alignEnd,
  leadingInset,
  onAction,
  onClose,
}: MessageContextMenuProps<Id>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);
  // Раскрытие привязано к открытию меню: следующее открытие — снова полосой.
  const [expandedFor, setExpandedFor] = useState<AnchorRect | null>(null);
  const expanded = anchor !== null && expandedFor === anchor;
  const menuHidden = useSharedValue(0);

  const picker = pickerGeometry(windowWidth - Spacing.two * 2);
  const menuHeight = actions.length * Sizes.menuRowHeight + Spacing.one * 2;
  const layout = anchor
    ? computeMenuLayout({
        anchorTop: anchor.y,
        anchorHeight: anchor.height,
        menuHeight,
        accessoryHeight: reactions ? picker.collapsedHeight : 0,
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
    menuHidden.set(0);
    progress.set(0);
    progress.set(withTiming(1, { duration: OPEN_MS }));
  }, [anchor, menuHidden, progress]);

  useEffect(() => {
    menuHidden.set(withTiming(expanded ? 1 : 0, { duration: OPEN_MS }));
  }, [expanded, menuHidden]);

  const finish = useCallback(() => {
    const after = pendingRef.current;

    pendingRef.current = null;
    onClose();

    // Действие — следующим кадром, отдельным от закрытия проходом. Иначе
    // окно меню исчезло бы только вместе с тем, что делает действие (вход в
    // выбор перерисовывает весь список), и касания, сделанные сразу после
    // выбора пункта, уходили бы в ещё не закрытое окно.
    if (after) requestAnimationFrame(after);
  }, [onClose]);

  const close = useCallback(
    (after: (() => void) | null) => {
      if (closingRef.current) return;

      closingRef.current = true;
      pendingRef.current = after;
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
    opacity: progress.value * (1 - menuHidden.value),
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));
  // Блок реакций проявляется вместе с меню и вырастает от края облачка.
  const pickerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.8 + progress.value * 0.2 }],
  }));

  const horizontal = anchor
    ? alignEnd
      ? { right: Math.max(Spacing.two, windowWidth - anchor.x - anchor.width) }
      : { left: anchor.x + leadingInset }
    : null;
  // Блок реакций шире меню: у своего — от правого края облачка, у чужого — от
  // левого, но всегда целиком на экране.
  const pickerRoom = windowWidth - Spacing.two - picker.width;
  const pickerHorizontal = anchor
    ? alignEnd
      ? { right: Math.max(Spacing.two, Math.min(windowWidth - anchor.x - anchor.width, pickerRoom)) }
      : { left: Math.max(Spacing.two, Math.min(anchor.x + leadingInset, pickerRoom)) }
    : null;
  const pickerMaxHeight = layout
    ? windowHeight - insets.bottom - Spacing.two - layout.accessoryTop
    : 0;

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
            // Раскрытые реакции закрывают меню собой — касаться его нечем.
            pointerEvents={expanded ? 'none' : 'auto'}
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
                onPress={() => close(() => onAction(action.id))}
                style={({ pressed }) => [
                  styles.item,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <Text color={action.destructive ? 'danger' : 'text'}>{action.label}</Text>
              </Pressable>
            ))}
          </Animated.View>

          {reactions ? (
            <ReactionPicker
              geometry={picker}
              selected={reactions.selected}
              expanded={expanded}
              maxHeight={pickerMaxHeight}
              onToggleExpanded={() => setExpandedFor(expanded ? null : anchor)}
              onSelect={(emoji) => close(() => reactions.onSelect(emoji))}
              style={[
                { top: layout.accessoryTop },
                alignEnd ? styles.originEnd : styles.originStart,
                pickerHorizontal,
                pickerStyle,
              ]}
            />
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
