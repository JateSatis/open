import { SymbolView } from 'expo-symbols';
import { Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Режим поиска включён: поле ввода и справа «Отмена». */
  active: boolean;
  /** Тап по строке, пока поиск выключен. */
  onActivate: () => void;
  onCancel: () => void;
  /** «Поиск» на клавиатуре. */
  onSubmit?: () => void;
  /** Начало testID кнопок и поля: у «Чатов» и «Ленты» свои. */
  testIDPrefix?: string;
};

/**
 * Строка поиска над «Чатами» и «Лентой». Своё поле, а не поиск в шапке стека: режим,
 * «Отмена» и клавиатура ведут себя одинаково на Android и iOS.
 *
 * Пока поиск выключен, поля ввода нет — только кнопка в его виде: Android сам
 * отдаёт фокус первому полю окна при запуске, и приложение открывалось бы
 * сразу в режиме поиска.
 */
export function SearchBar({
  value,
  onChangeText,
  active,
  onActivate,
  onCancel,
  onSubmit,
  testIDPrefix = 'chats-search',
}: SearchBarProps) {
  const theme = useTheme();
  const magnifier = (
    <SymbolView
      name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
      size={Sizes.searchIcon}
      tintColor={theme.textSecondary}
    />
  );

  if (!active) {
    return (
      <View style={styles.row}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Поиск"
          testID={`${testIDPrefix}-open`}
          onPress={onActivate}
          style={[styles.field, { backgroundColor: theme.backgroundElement }]}
        >
          {magnifier}
          <Text color="textSecondary">Поиск</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.field, { backgroundColor: theme.backgroundElement }]}>
        {magnifier}
        <TextInput
          autoFocus
          testID={`${testIDPrefix}-input`}
          accessibilityLabel="Поиск"
          placeholder="Поиск"
          placeholderTextColor={theme.textSecondary}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Отмена"
        testID={`${testIDPrefix}-cancel`}
        hitSlop={8}
        onPress={onCancel}
      >
        <Text color="primary">Отмена</Text>
      </Pressable>
    </View>
  );
}
