import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import { filterChips, type FilterChip, type SavedFilters } from '@/features/saved/savedFilters';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing, savedTagTone } from '@/theme';

export type SavedFilterBarProps = {
  filters: SavedFilters;
  tagsById: ReadonlyMap<string, SavedTag>;
  onRemove: (chip: FilterChip) => void;
  onReset: () => void;
};

/**
 * Строка активных фильтров под переключателем: слева ⊗ «Сбросить все»,
 * дальше чипы с крестиком — даты, типы, источники, теги в их цвете. Не
 * влезает — листается вбок. Фильтров нет — строки нет.
 */
export function SavedFilterBar({ filters, tagsById, onRemove, onReset }: SavedFilterBarProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const chips = useMemo(() => filterChips(filters), [filters]);

  if (chips.length === 0) return null;

  return (
    <ScrollView
      testID="saved-filter-bar"
      horizontal
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.bar}
      contentContainerStyle={styles.row}
    >
      <Pressable
        testID="saved-filters-reset"
        accessibilityRole="button"
        accessibilityLabel="Сбросить все фильтры"
        hitSlop={Spacing.one}
        onPress={onReset}
        style={[styles.reset, { backgroundColor: theme.backgroundElement }]}
      >
        <SymbolView
          name={{ ios: 'xmark.circle', android: 'cancel', web: 'cancel' }}
          size={Sizes.savedFilterChipIcon}
          tintColor={theme.textSecondary}
        />
      </Pressable>

      {chips.map((chip) => {
        const tag = chip.kind === 'tag' ? tagsById.get(chip.tagId) : undefined;

        // Тег, которого больше нет в списке тегов, — без чипа: снять его можно «Сбросить все».
        if (chip.kind === 'tag' && !tag) return null;

        const tone = tag ? savedTagTone(scheme, tag.color) : null;
        const label = chip.kind === 'tag' ? (tag?.name ?? '') : chip.label;
        const color = tone ? tone.text : theme.text;

        return (
          <Pressable
            key={chip.key}
            testID={`saved-filter-chip-${label}`}
            accessibilityRole="button"
            accessibilityLabel={`Снять фильтр: ${label}`}
            onPress={() => onRemove(chip)}
            style={[styles.chip, { backgroundColor: tone ? tone.fill : theme.backgroundElement }]}
          >
            <Text variant="smallBold" numberOfLines={1} style={{ color }}>
              {label}
            </Text>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={Sizes.savedFilterChipIcon}
              tintColor={color}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
