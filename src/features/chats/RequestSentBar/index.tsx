import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

/**
 * Вместо поля ввода у отправителя заявки на диалог. Отклонённая заявка
 * выглядит так же: отказ отправителю не раскрывается.
 */
export function RequestSentBar() {
  const theme = useTheme();

  return (
    <View testID="request-sent-bar" style={[styles.bar, { borderTopColor: theme.border }]}>
      <Text variant="bodyBold">Заявка отправлена</Text>
      <Text variant="small" color="textSecondary">
        Писать можно, когда собеседник её примет.
      </Text>
    </View>
  );
}
