import { SymbolView } from 'expo-symbols';
import { Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Режим поиска включён: справа «Отмена». */
  active: boolean;
  onFocus: () => void;
  onCancel: () => void;
};

/**
 * Строка поиска над «Чатами». Своё поле, а не поиск в шапке стека: режим,
 * «Отмена» и клавиатура ведут себя одинаково на Android и iOS.
 */
export function SearchBar({ value, onChangeText, active, onFocus, onCancel }: SearchBarProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.field, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={Sizes.searchIcon}
          tintColor={theme.textSecondary}
        />
        <TextInput
          testID="chats-search-input"
          accessibilityLabel="Поиск"
          placeholder="Поиск"
          placeholderTextColor={theme.textSecondary}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Очистить запрос"
            hitSlop={8}
            onPress={() => onChangeText('')}
          >
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={Sizes.searchIcon}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Отмена"
          testID="chats-search-cancel"
          hitSlop={8}
          onPress={onCancel}
        >
          <Text color="primary">Отмена</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
