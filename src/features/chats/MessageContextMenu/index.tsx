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

/** Над чем открыто меню: облачко и куда пришёлся палец. */
export type MenuAnchor = AnchorRect & {
  /** Касание по вертикали, в координатах окна; `null` — открыли не пальцем. */
  touchY: number | null;
};

/** Блок реакций над меню. Один и тот же у участника и у посетителя. */
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
  anchor: MenuAnchor | null;
  /**
   * Окно списка в координатах окна: копия облачка рисуется только в нём —
   * длинное облачко, ушедшее под заголовок или поле ввода, не вылезает
   * поверх них. Нет — копия видна целиком.
   */
  viewport: AnchorRect | null;
  /** Копия облачка над затемнением — на том же месте, что и в переписке. */
  preview: ReactNode;
  actions: readonly ContextMenuAction<Id>[];
  /** Нет — нет и блока реакций: у неотправленного и у системного сообщения. */
  reactions: MenuReactions | null;
  /** Действие выполняется после того, как меню закрылось: диалог подтверждения не ложится поверх меню. */
  onAction: (id: Id) => void;
  onClose: () => void;
};

/**
 * Меню сообщения по тапу. Своё окно (`Modal`) — единственный способ
 * затемнить и нативный заголовок, и нативный таб-бар (см. заметку про шит
 * медиа). Облачко не двигается: его копия стоит над затемнением ровно там,
 * где оно в переписке. Меню — у пальца и по горизонтали всегда в одной точке
 * экрана, над ним — блок реакций. Раскрытый блок растёт вниз, поверх меню,
 * до края экрана; действия на это время прячутся.
 */
export function MessageContextMenu<Id extends string>({
  anchor,
  viewport,
  preview,
  actions,
  reactions,
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
  const [expandedFor, setExpandedFor] = useState<MenuAnchor | null>(null);
  const expanded = anchor !== null && expandedFor === anchor;
  const menuHidden = useSharedValue(0);

  // Левый край реакций — посередине между краем экрана и левым краем меню.
  const menuLeft = Math.round(windowWidth * Sizes.menuLeftShare);
  const pickerLeft = Math.round(menuLeft / 2);
  const picker = pickerGeometry(windowWidth - Spacing.two - pickerLeft);
  const menuHeight = actions.length * Sizes.menuRowHeight + Spacing.one * 2;
  // Палец — посередине первого пункта.
  const touchOffset = Spacing.one + Sizes.menuRowHeight / 2;
  const layout = anchor
    ? computeMenuLayout({
        // Не пальцем — меню у верха облачка.
        touchY: anchor.touchY ?? anchor.y + touchOffset,
        touchOffset,
        menuHeight,
        accessoryHeight: reactions ? picker.collapsedHeight : 0,
        windowHeight,
        safeTop: insets.top,
        safeBottom: insets.bottom,
        margin: Spacing.two,
        gap: Spacing.two,
      })
    : null;

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
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - menuHidden.value),
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));
  // Блок реакций проявляется вместе с меню и вырастает от своего левого края.
  const pickerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.8 + progress.value * 0.2 }],
  }));

  const clipTop = viewport?.y ?? 0;
  const clipBottom = viewport ? viewport.y + viewport.height : windowHeight;
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
              // Раскрытые реакции тап мимо сворачивает, а не закрывает меню.
              onPress={() => (expanded ? setExpandedFor(null) : close(null))}
            />
          </Animated.View>

          <View
            pointerEvents="none"
            style={[styles.clip, { top: clipTop, height: Math.max(0, clipBottom - clipTop) }]}
          >
            <View
              testID="message-menu-preview"
              style={[
                styles.preview,
                {
                  top: anchor.y - clipTop,
                  left: anchor.x,
                  width: anchor.width,
                  height: anchor.height,
                },
              ]}
            >
              {preview}
            </View>
          </View>

          {/* Меню в строке с распоркой: распорка держит левый край в одной
              точке экрана, а широкому меню уступает — оно сдвигается влево
              ровно настолько, чтобы влезть, и не переносит пункты. */}
          <View
            testID="message-menu-row"
            pointerEvents="box-none"
            style={[styles.menuRow, { top: layout.menuTop }]}
          >
            <View pointerEvents="none" style={[styles.spacer, { width: menuLeft - Spacing.two }]} />
            <Animated.View
              testID="message-menu"
              // Раскрытые реакции закрывают меню собой — касаться его нечем.
              pointerEvents={expanded ? 'none' : 'auto'}
              style={[styles.menu, { backgroundColor: theme.backgroundElement }, menuStyle]}
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
                  <Text color={action.destructive ? 'danger' : 'text'} numberOfLines={1}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </Animated.View>
          </View>

          {reactions ? (
            <ReactionPicker
              geometry={picker}
              selected={reactions.selected}
              expanded={expanded}
              maxHeight={pickerMaxHeight}
              onToggleExpanded={() => setExpandedFor(expanded ? null : anchor)}
              onSelect={(emoji) => close(() => reactions.onSelect(emoji))}
              style={[
                styles.pickerOrigin,
                { top: layout.accessoryTop, left: pickerLeft },
                pickerStyle,
              ]}
            />
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
