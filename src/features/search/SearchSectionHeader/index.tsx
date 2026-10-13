import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type SearchSectionHeaderProps = {
  title: string;
  /** Кнопка справа: «Показать ещё», «Свернуть», «Очистить». Нет — заголовок без неё. */
  action?: { label: string; onPress: () => void };
};

export function SearchSectionHeader({ title, action }: SearchSectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { backgroundColor: theme.background }]}>
      <Text variant="smallBold" color="textSecondary">
        {title}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={action.onPress}>
          <Text variant="small" color="primary">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
