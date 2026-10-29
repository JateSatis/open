import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

export type SavedHeaderActionsProps = {
  /** Есть фильтры — значок отмечен точкой. */
  filtered: boolean;
  onSearch: () => void;
  onFilters: () => void;
};

/** Справа в шапке «Сохранённых»: поиск и фильтры. */
export function SavedHeaderActions({ filtered, onSearch, onFilters }: SavedHeaderActionsProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Pressable
        testID="saved-search-open"
        accessibilityRole="button"
        accessibilityLabel="Поиск"
        hitSlop={Spacing.two}
        onPress={onSearch}
      >
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={InfoPageSizes.barIcon}
          tintColor={theme.primary}
        />
      </Pressable>
      <Pressable
        testID="saved-filters-open"
        accessibilityRole="button"
        accessibilityLabel={filtered ? 'Фильтры, выбраны' : 'Фильтры'}
        hitSlop={Spacing.two}
        onPress={onFilters}
      >
        <SymbolView
          name={{
            ios: 'line.3.horizontal.decrease.circle',
            android: 'filter_list',
            web: 'filter_list',
          }}
          size={InfoPageSizes.barIcon}
          tintColor={theme.primary}
        />
        {filtered ? (
          <View
            testID="saved-filters-dot"
            style={[styles.dot, { backgroundColor: theme.primary, borderColor: theme.background }]}
          />
        ) : null}
      </Pressable>
    </View>
  );
}
