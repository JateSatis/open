import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles, TAG_BLOCK_PADDING } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import type { MenuAccessoryProps } from '@/features/chats/MessageContextMenu';
import { NewTagField } from '@/features/saved/NewTagField';
import { SavedTagChip } from '@/features/saved/SavedTagChip';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

const EXPAND_MS = 220;

/** Свёрнутый блок — одна полоса, ровно как у реакций. */
export const TAG_BLOCK_HEIGHT = Sizes.reactionCell + TAG_BLOCK_PADDING * 2;

export type SavedTagBlockProps = Omit<MenuAccessoryProps, 'close'> & {
  /** Все теги человека, самые используемые первыми. */
  tags: SavedTag[];
  /** Теги записи — в порядке, в каком их поставили. */
  selectedIds: readonly string[];
  onToggle: (tagId: string) => void;
  onCreate: (name: string) => Promise<void>;
};

/** Порядок на открытие меню: выбранные, потом остальные по популярности. */
function orderOf(tags: SavedTag[], selectedIds: readonly string[]): string[] {
  const known = new Set(tags.map((tag) => tag.id));
  const selected = selectedIds.filter((id) => known.has(id));
  const chosen = new Set(selected);

  return [...selected, ...tags.filter((tag) => !chosen.has(tag.id)).map((tag) => tag.id)];
}

/**
 * Теги записи над меню «Сохранённых» — на месте реакций и того же вида.
 * Свёрнутый — полоса тегов, сколько влезает; слева стрелка раскрытия и
 * «+N» — сколько выбранных не влезло. Раскрытый — все теги, первым «+» с
 * полем имени прямо в ряду. Тап ставит или снимает тег сразу, меню остаётся
 * открытым. Порядок держится, пока меню открыто: чип не уезжает из-под
 * пальца, когда его выбрали.
 */
export function SavedTagBlock({
  tags,
  selectedIds,
  onToggle,
  onCreate,
  width,
  expanded,
  maxHeight,
  top,
  onToggleExpanded,
  style,
}: SavedTagBlockProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [order, setOrder] = useState(() => orderOf(tags, selectedIds));
  const [wrapped, setWrapped] = useState<ReadonlySet<string>>(() => new Set());
  const [contentHeight, setContentHeight] = useState(TAG_BLOCK_HEIGHT);
  const [keyboard, setKeyboard] = useState(0);
  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Новый тег — сразу за выбранными, где его и ждут.
  const missing = tags.filter((tag) => !order.includes(tag.id)).map((tag) => tag.id);

  if (missing.length > 0) setOrder([...missing, ...order]);

  // Меню — своё окно: клавиатуру поля имени слушаем отсюда, как панель комментариев.
  useEffect(() => {
    const shown = KeyboardEvents.addListener('keyboardDidShow', (event) =>
      setKeyboard(event.height),
    );
    const hidden = KeyboardEvents.addListener('keyboardDidHide', () => setKeyboard(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const shownTags = order.flatMap((id) => byId.get(id) ?? []);
  const hiddenSelected = expanded
    ? 0
    : shownTags.filter((tag) => selected.has(tag.id) && wrapped.has(tag.id)).length;
  const room = keyboard > 0 ? windowHeight - keyboard - Spacing.two : windowHeight;
  const tallest = keyboard > 0 ? room - insets.top - Spacing.two : maxHeight;
  const target = expanded
    ? Math.max(TAG_BLOCK_HEIGHT, Math.min(contentHeight, tallest))
    : TAG_BLOCK_HEIGHT;
  // Блок над клавиатурой: поднимается ровно настолько, чтобы низ был виден.
  const lift = keyboard > 0 ? Math.max(0, top + target - room) : 0;

  const height = useSharedValue(target);
  const shift = useSharedValue(lift);
  const turn = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    height.set(withTiming(target, { duration: EXPAND_MS }));
    shift.set(withTiming(lift, { duration: EXPAND_MS }));
    turn.set(withTiming(expanded ? 1 : 0, { duration: EXPAND_MS }));
  }, [expanded, height, lift, shift, target, turn]);

  const blockStyle = useAnimatedStyle(() => ({
    height: height.value,
    marginTop: -shift.value,
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  const measureChip = (id: string) => (event: LayoutChangeEvent) => {
    // Ниже первой строки — не влез в свёрнутую полосу.
    const below = event.nativeEvent.layout.y > Spacing.five / 2;

    setWrapped((current) => {
      if (current.has(id) === below) return current;

      const next = new Set(current);

      if (below) next.add(id);
      else next.delete(id);

      return next;
    });
  };

  const empty = shownTags.length === 0;

  return (
    <Animated.View
      testID="saved-tag-block"
      style={[styles.block, { width, backgroundColor: theme.backgroundElement }, style, blockStyle]}
    >
      <ScrollView
        scrollEnabled={expanded}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={styles.content}
          onLayout={(event) => setContentHeight(Math.ceil(event.nativeEvent.layout.height))}
        >
          {empty ? null : (
            <View style={styles.lead}>
              {hiddenSelected > 0 ? (
                <Text testID="saved-tag-more" variant="smallBold" color="textSecondary">
                  {`+${hiddenSelected}`}
                </Text>
              ) : null}
              <Pressable
                testID="saved-tag-expand"
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Свернуть теги' : 'Все теги'}
                accessibilityState={{ expanded }}
                onPress={onToggleExpanded}
                hitSlop={Spacing.one}
                style={styles.expand}
              >
                <Animated.View style={chevronStyle}>
                  <SymbolView
                    name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                    size={Spacing.four}
                    tintColor={theme.textSecondary}
                  />
                </Animated.View>
              </Pressable>
            </View>
          )}

          <View style={styles.chips}>
            {expanded || empty ? (
              <NewTagField
                onCreate={onCreate}
                onElement
                // Пока пишут имя, блок раскрыт и закрывает собой пункты меню.
                onStart={expanded ? undefined : onToggleExpanded}
              />
            ) : null}
            {shownTags.map((tag) => (
              <SavedTagChip
                key={tag.id}
                tag={tag}
                selected={selected.has(tag.id)}
                onPress={() => onToggle(tag.id)}
                onLayout={measureChip(tag.id)}
                onElement
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  );
}
