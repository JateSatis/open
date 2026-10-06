import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
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
import { useSwipeReply } from './useSwipeReply';

import { Text } from '@/components/Text';
import type { MenuAnchor } from '@/features/chats/MessageContextMenu';
import { RowRegistryContext } from '@/features/chats/rowRegistry';
import { liftedRowKey } from '@/features/interactions/comments/commentsLift';
import { useTheme } from '@/hooks/use-theme';

/** Столько держать палец, чтобы включился выбор. */
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
  /** Это сообщение сейчас правится — облачко подсвечено, пока поле в режиме правки. */
  editing?: boolean;
  /** Меняется при каждом прыжке к сообщению — подсветка вспыхивает заново. */
  highlightKey: number | null;
  /**
   * Ключ строки: id сообщения, у облачка островка — ключ облачка. Над строкой
   * может быть открыто меню: её копия поднята над затемнением, а сама строка
   * прячется.
   */
  messageId: string;
  /** Тап по облачку — меню у строки. Нет обработчика — тап ничего не делает. */
  onOpenMenu?: (anchor: MenuAnchor) => void;
  /** Долгое нажатие — выбор с этим облачком уже отмеченным. Нет — долгого нажатия нет. */
  onSelect?: () => void;
  /** Тап в режиме выбора — снять или поставить отметку. */
  onToggle: () => void;
  /** Свайп влево — ответить. Без обработчика (посетитель, неотправленное) жеста нет. */
  onSwipeReply?: () => void;
  /**
   * Слой за облачком, который не уезжает со свайпом и не прячется под
   * меню, — кусок рамки островка: облачко отъезжает, рамка стоит на месте.
   */
  frame?: ReactNode;
};

/**
 * Строка переписки вокруг облачка, как в Telegram на Android: тап открывает
 * меню, долгое нажатие включает выбор, свайп влево — ответ. В режиме выбора
 * слева появляется кружок, а тап по строке отмечает сообщение.
 *
 * Тап ловит обычный `Pressable` строки, а не жест-обработчик: касание в RN
 * достаётся самому глубокому, кто его хочет, — плитка альбома, цитата, имя
 * автора, реакции и кнопки внутри облачка берут свой тап сами, и меню не
 * открывается. Перемотку голосового, свайп и долгое нажатие ведут
 * жест-обработчики: узнав себя, они отменяют касание строки, и тап уже не
 * случится.
 */
export function MessageRow({
  children,
  selectionMode,
  selectable,
  selected,
  editing = false,
  highlightKey,
  messageId,
  onOpenMenu,
  onSelect,
  onToggle,
  onSwipeReply,
  frame,
}: MessageRowProps) {
  const theme = useTheme();
  const highlight = useSharedValue(0);
  const lifted = useIsLifted(messageId);
  const swipe = useSwipeReply(messageId, !selectionMode, onSwipeReply);
  const contentRef = useRef<View>(null);
  const registry = useContext(RowRegistryContext);

  // Шит комментариев меряет строку снаружи списка — по ключу.
  useEffect(() => registry?.register(messageId, contentRef), [messageId, registry]);

  // Копия строки над затемнением меню или над шитом комментариев: сама
  // строка пуста, пока копия на экране. Не удаляется — иначе переписка
  // сдвинулась бы. Прозрачность одна на оба случая: анимированный стиль
  // перекрыл бы статический, где бы тот ни стоял.
  const hiddenStyle = useAnimatedStyle(
    () => ({ opacity: lifted || liftedRowKey.value === messageId ? 0 : 1 }),
    [lifted, messageId],
  );

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
    (event?: GestureResponderEvent) => {
      if (!onOpenMenu) return;

      // Меню встаёт у пальца, копия облачка — ровно на его место: нужны
      // касание и угол с размером строки в окне. Без события (доступность,
      // тесты) касания нет — меню встанет у облачка.
      const touchY = event?.nativeEvent?.pageY ?? null;

      contentRef.current?.measureInWindow((x, y, width, height) =>
        onOpenMenu({ x, y, width, height, touchY }),
      );
    },
    [onOpenMenu],
  );

  const select = useCallback(() => {
    impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
    onSelect?.();
  }, [onSelect]);

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LONG_PRESS_MS)
        .enabled(!selectionMode && onSelect !== undefined)
        .withTestId(`message-long-press-${messageId}`)
        .onStart(() => {
          runOnJS(select)();
        }),
    [messageId, onSelect, select, selectionMode],
  );

  // Кто первым узнал себя, тот и ведёт: сдвиг пальца отменяет долгое
  // нажатие, а удержание на месте не даёт начаться свайпу.
  const gesture = useMemo(
    () => Gesture.Race(swipe.gesture, longPress),
    [longPress, swipe.gesture],
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

      {selected || editing ? (
        <View
          pointerEvents="none"
          style={[styles.fill, { backgroundColor: theme.messageHighlight }]}
        />
      ) : null}

      {onSwipeReply ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.swipeIcon, { backgroundColor: theme.backgroundElement }, swipe.iconStyle]}
        >
          <Text color="textSecondary">↩</Text>
        </Animated.View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View collapsable={false}>
          <Pressable
            accessibilityRole={selectionMode ? 'checkbox' : undefined}
            accessibilityState={selectionMode ? { checked: selected, disabled: !selectable } : undefined}
            accessibilityLabel={
              selectionMode ? (selected ? 'Снять отметку' : 'Отметить сообщение') : undefined
            }
            accessible={selectionMode}
            testID={`message-row-${messageId}`}
            disabled={selectionMode ? !selectable : !onOpenMenu}
            onPress={selectionMode ? onToggle : openMenu}
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

            <View ref={contentRef} style={styles.content}>
              {frame}

              {/* В режиме выбора облачко не живёт своей жизнью: тап не открывает
                  просмотрщик, не запускает голосовое и не ведёт в профиль. */}
              <Animated.View
                pointerEvents={selectionMode ? 'none' : 'auto'}
                style={[hiddenStyle, swipe.contentStyle]}
              >
                {children}
              </Animated.View>
            </View>
          </Pressable>
        </View>
      </GestureDetector>
    </View>
  );
}
