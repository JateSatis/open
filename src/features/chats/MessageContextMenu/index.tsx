import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeMenuLayout } from './menuLayout';
import { styles } from './styles';

import { MenuList, menuListHeight, type MenuAction } from '@/components/MenuList';
import { MENU_OPEN_MS, MenuModal, useMenuTransition } from '@/components/MenuModal';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { logReactionPicker } from '@/features/recs/journal/chatJournal';
import { Opacity, Sizes, Spacing } from '@/theme';

/** Прямоугольник облачка в координатах окна — где оно стоит в переписке. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

/** Над чем открыто меню: облачко и куда пришёлся палец. */
export type MenuAnchor = AnchorRect & {
  /** Касание по вертикали, в координатах окна; `null` — открыли не пальцем. */
  touchY: number | null;
};

/** Блок реакций над меню. */
export type MenuReactions = {
  /** Моя реакция на это сообщение — подсвечена; тап по ней снимает. */
  selected: string | null;
  /**
   * Только эти реакции, по популярности: мой ряд полон, новую разную база
   * не примет. Нет — весь набор.
   */
  options?: readonly string[];
  /** Сколько каждой уже стоит в моём ряду — число рядом с эмодзи (у зрителя). */
  counts?: Readonly<Record<string, number>>;
  /** Кнопка раскрытия. Полный набор зрителей виден сразу целиком. */
  expandable?: boolean;
  /** Реакция ставится после того, как меню закрылось, — как и действие. */
  onSelect: (emoji: string) => void;
};

/** Что получает свой блок над меню: место, раскрытие и закрытие меню. */
export type MenuAccessoryProps = {
  /** Ширина — как у блока реакций. */
  width: number;
  expanded: boolean;
  /** Раскрытый блок не растёт ниже края экрана. */
  maxHeight: number;
  /** Верх блока в координатах окна — чтобы поднять его над клавиатурой. */
  top: number;
  onToggleExpanded: () => void;
  /** Закрыть меню; `after` — когда оно закрылось. */
  close: (after?: () => void) => void;
  /** Где стоит и как появляется — решает меню. */
  style: StyleProp<AnimatedStyle<ViewStyle>>;
};

/**
 * Свой блок над меню вместо реакций — теги в «Сохранённых». Ставится и
 * раскрывается так же: свёрнутый — полоса над меню, раскрытый растёт вниз
 * поверх меню, тап мимо сначала сворачивает.
 */
export type MenuAccessory = {
  /** Высота свёрнутого блока — меню ставится, не измеряя его. */
  collapsedHeight: number;
  render: (props: MenuAccessoryProps) => ReactNode;
};

/** Пункт меню. Меню одно на сообщения и комментарии — пункты у них свои. */
export type ContextMenuAction<Id extends string = string> = MenuAction<Id>;

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
  /**
   * Куда растёт копия, если строка меняется при открытом меню (теги в
   * «Сохранённых»): `up` — в перевёрнутом списке, где строка растёт вверх,
   * `down` — в обычном. Нет — копия ровно размером со строку.
   */
  previewGrowth?: 'up' | 'down';
  actions: readonly ContextMenuAction<Id>[];
  /** Нет — нет и блока реакций: у неотправленного и у системного сообщения. */
  reactions: MenuReactions | null;
  /** Свой блок на месте реакций — когда реакций нет. */
  accessory?: MenuAccessory | null;
  /** Действие выполняется после того, как меню закрылось: диалог подтверждения не ложится поверх меню. */
  onAction: (id: Id) => void;
  onClose: () => void;
  /** Чьё меню — для журнала: выбрали реакцию или закрыли, не выбрав. */
  journalSubject?: { type: 'message' | 'comment'; id: string } | null;
};

/**
 * Меню сообщения по тапу. Окно и затемнение — общие (`MenuModal`). Облачко не двигается и не прячется: строка остаётся в переписке
 * под затемнением, а полупрозрачная копия лежит ровно поверх неё и
 * высветляет облачко — без пустого кадра, пока окно и картинки копии
 * догружаются. Меню — у пальца и по горизонтали всегда в одной точке
 * экрана, над ним — блок реакций. Раскрытый блок растёт вниз, поверх меню,
 * до края экрана; действия на это время прячутся.
 */
export function MessageContextMenu<Id extends string>({
  anchor,
  viewport,
  preview,
  previewGrowth,
  actions,
  reactions,
  accessory = null,
  onAction,
  onClose,
  journalSubject = null,
}: MessageContextMenuProps<Id>) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { progress, close } = useMenuTransition(anchor, onClose);
  // Раскрытие привязано к открытию меню: следующее открытие — снова полосой.
  const [expandedFor, setExpandedFor] = useState<MenuAnchor | null>(null);
  const expanded = anchor !== null && expandedFor === anchor;
  const menuHidden = useSharedValue(0);

  // Журнал: меню с реакциями открыли — выбрали реакцию или закрыли без неё.
  const pickerSession = useRef<{
    subject: { type: 'message' | 'comment'; id: string };
    at: number;
    emoji: string | null;
  } | null>(null);
  const hasReactions = reactions !== null;

  useEffect(() => {
    if (anchor && hasReactions && journalSubject && !pickerSession.current) {
      pickerSession.current = { subject: journalSubject, at: Date.now(), emoji: null };
    }

    if (!anchor && pickerSession.current) {
      const { subject, at, emoji } = pickerSession.current;

      pickerSession.current = null;
      logReactionPicker(
        subject,
        emoji ? 'picked' : 'cancelled',
        Date.now() - at,
        emoji ?? undefined,
      );
    }
  }, [anchor, hasReactions, journalSubject]);

  // Левый край реакций — посередине между краем экрана и левым краем меню.
  const menuLeft = Math.round(windowWidth * Sizes.menuLeftShare);
  const pickerLeft = Math.round(menuLeft / 2);
  const picker = pickerGeometry(windowWidth - Spacing.two - pickerLeft, {
    options: reactions?.options,
    counts: reactions?.counts,
    expandable: reactions?.expandable,
  });
  const menuHeight = menuListHeight(actions.length);
  // Палец — посередине первого пункта.
  const touchOffset = Spacing.one + Sizes.menuRowHeight / 2;
  const layout = anchor
    ? computeMenuLayout({
        // Не пальцем — меню у верха облачка.
        touchY: anchor.touchY ?? anchor.y + touchOffset,
        touchOffset,
        menuHeight,
        accessoryHeight: reactions ? picker.collapsedHeight : (accessory?.collapsedHeight ?? 0),
        windowHeight,
        safeTop: insets.top,
        safeBottom: insets.bottom,
        margin: Spacing.two,
        gap: Spacing.two,
      })
    : null;

  useEffect(() => {
    if (anchor) menuHidden.set(0);
  }, [anchor, menuHidden]);

  useEffect(() => {
    menuHidden.set(withTiming(expanded ? 1 : 0, { duration: MENU_OPEN_MS }));
  }, [expanded, menuHidden]);

  // Копия проявляется вместе с затемнением: облачко под ней темнеет вместе с
  // экраном, а копия возвращает ему часть яркости.
  const previewStyle = useAnimatedStyle(() => ({ opacity: progress.value * Opacity.menuCopy }));
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
    <MenuModal
      visible={anchor !== null}
      progress={progress}
      onRequestClose={() => close(null)}
      backdropTestID="message-menu-backdrop"
      // Раскрытый блок над меню тап мимо сворачивает, а не закрывает меню.
      onBackdropPress={() => (expanded ? setExpandedFor(null) : close(null))}
    >
      {anchor && layout ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.clip, { top: clipTop, height: Math.max(0, clipBottom - clipTop) }]}
          >
            <Animated.View
              testID="message-menu-preview"
              style={[
                styles.preview,
                previewGrowth === 'up'
                  ? {
                      bottom: clipBottom - (anchor.y + anchor.height),
                      left: anchor.x,
                      width: anchor.width,
                    }
                  : {
                      top: anchor.y - clipTop,
                      left: anchor.x,
                      width: anchor.width,
                      height: previewGrowth === 'down' ? undefined : anchor.height,
                    },
                previewStyle,
              ]}
            >
              {/* Копия с первого кадра как оригинал: её реакции не проявляются заново. */}
              <LayoutAnimationConfig skipEntering>{preview}</LayoutAnimationConfig>
            </Animated.View>
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
            <MenuList
              testID="message-menu"
              actions={actions}
              onSelect={(id) => close(() => onAction(id))}
              // Раскрытые реакции закрывают меню собой — касаться его нечем.
              pointerEvents={expanded ? 'none' : 'auto'}
              style={[styles.menu, menuStyle]}
            />
          </View>

          {reactions ? (
            <ReactionPicker
              geometry={picker}
              selected={reactions.selected}
              expanded={expanded}
              maxHeight={pickerMaxHeight}
              onToggleExpanded={() => setExpandedFor(expanded ? null : anchor)}
              onSelect={(emoji) => {
                if (pickerSession.current) pickerSession.current.emoji = emoji;
                close(() => reactions.onSelect(emoji));
              }}
              style={[
                styles.pickerOrigin,
                { top: layout.accessoryTop, left: pickerLeft },
                pickerStyle,
              ]}
            />
          ) : accessory ? (
            accessory.render({
              width: picker.width,
              expanded,
              maxHeight: pickerMaxHeight,
              top: layout.accessoryTop,
              onToggleExpanded: () => setExpandedFor(expanded ? null : anchor),
              close: (after) => close(after ?? null),
              style: [
                styles.pickerOrigin,
                { top: layout.accessoryTop, left: pickerLeft },
                pickerStyle,
              ],
            })
          ) : null}
        </>
      ) : null}
    </MenuModal>
  );
}
