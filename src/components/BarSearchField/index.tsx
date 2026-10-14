import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { BackHandler, Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Sizes } from '@/theme';

export type BarSearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Стрелка «назад» и системный «назад»: поиск закрывается, экран остаётся. */
  onClose: () => void;
  placeholder: string;
  testID?: string;
};

/**
 * Поле поиска на месте верхней панели: стрелка, ввод с клавиатурой сразу и
 * «✕», очищающий запрос. Системный «назад» закрывает поиск, а не экран.
 */
export function BarSearchField({
  value,
  onChangeText,
  onClose,
  placeholder,
  testID,
}: BarSearchFieldProps) {
  const theme = useTheme();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose]);

  return (
    <View style={styles.row}>
      <Pressable
        testID={testID ? `${testID}-close` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Закрыть поиск"
        hitSlop={Sizes.searchIcon}
        onPress={onClose}
        style={styles.button}
      >
        <SymbolView
          name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          size={InfoPageSizes.barIcon}
          tintColor={theme.text}
        />
      </Pressable>
      <TextInput
        autoFocus
        testID={testID}
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.input, { color: theme.text }]}
      />
      {value ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel="Очистить запрос"
          hitSlop={Sizes.searchIcon}
          onPress={() => onChangeText('')}
          style={styles.button}
        >
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={InfoPageSizes.barIcon}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
