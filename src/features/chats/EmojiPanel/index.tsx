import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { SymbolView } from 'expo-symbols';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { buildEmojiGrid, EMOJI_SECTIONS, type EmojiRow, type EmojiSectionKey } from './emojiRows';
import { useRecentEmoji } from './recentEmoji';

import { Text } from '@/components/Text';
import {
  emojiPanelHeight,
  getEmojiPanelOwner,
  type KeyboardOwner,
} from '@/features/chats/composerKeyboard';
import { useTheme } from '@/hooks/use-theme';
import { ComposerSizes, Opacity, Radii, Spacing } from '@/theme';

export { closeEmojiPanel, useEmojiPanel, type EmojiPanelControl } from './useEmojiPanel';
export { deleteBefore, insertAt, type Selection } from './emojiText';
export { rememberEmoji } from './recentEmoji';

const S = ComposerSizes;

export type EmojiPanelProps = {
  /** Чьё это поле: панель одна, и рисуется только у того, кто её открыл. */
  owner: KeyboardOwner;
  /** Высота содержимого: по ней раскладка, пока сама панель выезжает. */
  size: number;
  /** Панель открыта (а не просто смонтирована с прошлого раза). */
  open: boolean;
  onPick: (emoji: string) => void;
  onDelete: () => void;
  /** Первая раскладка: панель на экране, клавиатуру можно убирать. */
  onReady: () => void;
};

/**
 * Панель эмодзи на месте клавиатуры: сетка по разделам, внизу вкладки
 * разделов («Недавние» — первая) и «стереть». Высоту ведёт
 * `emojiPanelHeight` — кадр в кадр с тем, что `composerKeyboard` отдаёт
 * хозяину поля.
 */
export function EmojiPanel({ owner, size, open, onPick, onDelete, onReady }: EmojiPanelProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const recent = useRecentEmoji();
  const listRef = useRef<FlashListRef<EmojiRow>>(null);
  const gridWidth = width - Spacing.two * 2;
  const columns = Math.max(1, Math.floor(gridWidth / S.emojiCell));
  // Клетки делят ширину поровну: ряд от края до края, без пустоты справа.
  const cellWidth = gridWidth / columns;
  // «Недавние» снимаются один раз на открытие: сетка не перестраивается под
  // пальцем, пока человек выбирает подряд.
  const [shownRecent, setShownRecent] = useState(recent);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setShownRecent(recent);
  }
  const grid = useMemo(() => buildEmojiGrid(shownRecent, columns), [columns, shownRecent]);
  const [active, setActive] = useState<EmojiSectionKey>(grid.rows[0]?.section ?? 'recent');

  // Высота читается всегда: по ней реакция стиля и пересчитывается, когда
  // панель переходит к другому полю.
  const style = useAnimatedStyle(() => {
    const height = emojiPanelHeight.value;

    return { height: getEmojiPanelOwner() === owner ? height : 0 };
  });

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<EmojiRow>[] }) => {
    const first = viewableItems.find((token) => token.item);

    if (first?.item) setActive(first.item.section);
  }, []);

  const jump = (key: EmojiSectionKey) => {
    if (key === 'recent') setShownRecent(recent);
    setActive(key);
    listRef.current?.scrollToIndex({ index: grid.starts[key], animated: false });
  };

  const renderItem = useCallback(
    ({ item }: { item: EmojiRow }) =>
      item.type === 'header' ? (
        <Text variant="smallBold" color="textSecondary" style={styles.header}>
          {item.title}
        </Text>
      ) : (
        <EmojiLine emojis={item.emojis} cellWidth={cellWidth} onPick={onPick} />
      ),
    [cellWidth, onPick],
  );

  return (
    <Animated.View
      testID="emoji-panel"
      style={[styles.panel, { backgroundColor: theme.backgroundElement }, style]}
    >
      {/* Своей высоты, не анимируется: раскладка — один раз, а не на каждый кадр выезда. */}
      <View style={{ height: size }} onLayout={onReady}>
        <View style={styles.grid}>
          <FlashList
            ref={listRef}
            data={grid.rows}
            renderItem={renderItem}
            keyExtractor={(row) => row.key}
            getItemType={(row) => row.type}
            onViewableItemsChanged={onViewable}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.gridContent}
          />
        </View>

        <View style={[styles.tabs, { borderTopColor: theme.border }]}>
          <View style={styles.tabList}>
            {EMOJI_SECTIONS.map((section) => (
              <Pressable
                key={section.key}
                testID={`emoji-tab-${section.key}`}
                accessibilityRole="tab"
                accessibilityLabel={section.title}
                accessibilityState={{ selected: active === section.key }}
                onPress={() => jump(section.key)}
                style={({ pressed }) => [
                  styles.tab,
                  active === section.key && { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}
              >
                <SymbolView
                  name={section.icon}
                  size={S.emojiTabIcon}
                  tintColor={active === section.key ? theme.text : theme.textSecondary}
                />
              </Pressable>
            ))}
          </View>
          <Pressable
            testID="emoji-delete"
            accessibilityRole="button"
            accessibilityLabel="Стереть"
            onPress={onDelete}
            hitSlop={Spacing.one}
            style={({ pressed }) => [styles.tab, styles.deleteKey, pressed && styles.pressed]}
          >
            <SymbolView
              name={{ ios: 'delete.left', android: 'backspace', web: 'backspace' }}
              size={S.emojiTabIcon}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

/** Строка сетки. Мемо: при прокрутке переиспользуемые клетки не пересчитываются зря. */
const EmojiLine = memo(function EmojiLine({
  emojis,
  cellWidth,
  onPick,
}: {
  emojis: string[];
  cellWidth: number;
  onPick: (emoji: string) => void;
}) {
  return (
    <View style={styles.line}>
      {emojis.map((emoji) => (
        <Pressable
          key={emoji}
          testID={`emoji-${emoji}`}
          accessibilityRole="button"
          accessibilityLabel={emoji}
          onPress={() => onPick(emoji)}
          style={({ pressed }) => [
            styles.cell,
            { width: cellWidth },
            pressed && styles.cellPressed,
          ]}
        >
          <Text style={styles.glyph} allowFontScaling={false}>
            {emoji}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: Spacing.two,
  },
  header: {
    height: S.emojiHeader,
    paddingHorizontal: Spacing.one,
    textAlignVertical: 'center',
    lineHeight: S.emojiHeader,
  },
  line: {
    flexDirection: 'row',
  },
  cell: {
    height: S.emojiCell,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  cellPressed: {
    opacity: Opacity.pressed,
  },
  glyph: {
    fontSize: S.emojiGlyph,
    lineHeight: S.emojiCell,
  },
  tabs: {
    height: S.emojiTabs,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabList: {
    flex: 1,
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    maxWidth: S.emojiTabs,
    height: S.emojiTabs - Spacing.one * 2,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** «Стереть» — своей ширины справа: вкладки делят остальное. */
  deleteKey: {
    flex: 0,
    width: S.emojiTabs,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
