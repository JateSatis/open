import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { BackHandler, Pressable, TextInput, View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Sizes } from '@/theme';

const FOCUS_DELAY_MS = 100;

export type BarSearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** Стрелка «назад» и системный «назад»: поиск закрывается, экран остаётся. */
  onClose: () => void;
  placeholder: string;
  /**
   * Отдать полю фокус, когда это станет `true`, — если экран под полем
   * открывается из-под другого (страница чата ещё уезжает), `autoFocus`
   * срабатывает слишком рано. Не задано — фокус сразу.
   */
  focusWhen?: boolean;
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
  focusWhen,
  testID,
}: BarSearchFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!focusWhen) return;

    // Кадр на то, чтобы экран принял фокус после ухода страницы сверху.
    const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);

    return () => clearTimeout(timer);
  }, [focusWhen]);

  // Системный «назад» — поиску, только пока его экран наверху: открытый
  // поверх профиль иначе не закрывался бы, а под ним закрывался поиск.
  const isScreenFocused = useIsFocused();

  useEffect(() => {
    if (!isScreenFocused) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [isScreenFocused, onClose]);

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
        ref={inputRef}
        autoFocus={focusWhen === undefined}
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
