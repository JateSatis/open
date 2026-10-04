import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type ThreadToggleProps = {
  /** Сколько ответов в треде. */
  count: number;
  open: boolean;
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
 * Кнопка треда сбоку от облачка корня: у чужого — справа, у своего — слева.
 * Закрытый тред — число ответов, раскрытый — «Скрыть».
 */
export function ThreadToggle({ count, open, onPress }: ThreadToggleProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="thread-toggle"
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? 'Скрыть ответы' : `Показать ${repliesLabel(count)}`}
      hitSlop={Spacing.two}
      onPress={onPress}
      style={[styles.threadToggle, { backgroundColor: open ? theme.islandPlate : theme.backgroundElement }]}
    >
      <Text variant="caption" color={open ? 'primary' : 'textSecondary'}>
        {open ? 'Скрыть' : repliesLabel(count)}
      </Text>
      <SymbolView
        name={
          open
            ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }
            : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
        }
        size={Sizes.threadToggleIcon}
        tintColor={open ? theme.primary : theme.textSecondary}
      />
    </Pressable>
  );
}
