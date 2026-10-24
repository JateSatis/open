import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { styles, TAG_BLOCK_PADDING } from './styles';
import { useTagBlockMotion } from './useTagBlockMotion';
import { useWrappedChips } from './useWrappedChips';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import type { MenuAccessoryProps } from '@/features/chats/MessageContextMenu';
import { NewTagField } from '@/features/saved/NewTagField';
import { SavedTagChip } from '@/features/saved/SavedTagChip';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

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
  const [order, setOrder] = useState(() => orderOf(tags, selectedIds));
  const [contentHeight, setContentHeight] = useState(TAG_BLOCK_HEIGHT);
  const chips = useWrappedChips();
  const motion = useTagBlockMotion({
    expanded,
    collapsedHeight: TAG_BLOCK_HEIGHT,
    contentHeight,
    maxHeight,
    top,
  });
  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Новый тег — сразу за выбранными, где его и ждут.
  const missing = tags.filter((tag) => !order.includes(tag.id)).map((tag) => tag.id);

  if (missing.length > 0) setOrder([...missing, ...order]);

  const shownTags = order.flatMap((id) => byId.get(id) ?? []);
  const hiddenSelected = expanded
    ? 0
    : shownTags.filter((tag) => selected.has(tag.id) && chips.wrapped.has(tag.id)).length;

  const empty = shownTags.length === 0;

  return (
    <Animated.View
      testID="saved-tag-block"
      style={[
        styles.block,
        { width, backgroundColor: theme.backgroundElement },
        style,
        motion.blockStyle,
      ]}
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
                <Animated.View style={motion.chevronStyle}>
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
                onLayout={chips.measure(tag.id)}
                onElement
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  );
}
