import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type RepliesButtonProps = {
  /** Сколько ответов в треде. */
  count: number;
  /** Своё облачко — кнопка под его правым краем. */
  isOwn: boolean;
  onPress: () => void;
};

/** «3 ответа» — по-русски. */
export function repliesLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;

  if (tens >= 11 && tens <= 14) return `${count} ответов`;
  if (ones === 1) return `${count} ответ`;
  if (ones >= 2 && ones <= 4) return `${count} ответа`;

  return `${count} ответов`;
}

/**
 * «N ответов ›» под облачком корня, по его краю: у чужого — под левым, у
 * своего — под правым. Открывает окно треда.
 */
export function RepliesButton({ count, isOwn, onPress }: RepliesButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="thread-open"
      accessibilityRole="button"
      accessibilityLabel={`Показать ${repliesLabel(count)}`}
      hitSlop={Spacing.two}
      onPress={onPress}
      style={[styles.repliesButton, isOwn ? styles.repliesButtonOwn : styles.repliesButtonOther]}
    >
      <Text variant="smallBold" color="primary">
        {repliesLabel(count)}
      </Text>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={Sizes.threadToggleIcon}
        tintColor={theme.primary}
      />
    </Pressable>
  );
}
