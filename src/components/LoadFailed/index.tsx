import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';

export type LoadFailedProps = {
  /** Что не получилось — «Не удалось загрузить переписку». */
  message: string;
  onRetry: () => void;
};

/**
 * Показать нечего: данных нет, а все тихие попытки не удались. Вместо крутилки,
 * которая обещала бы, что данные вот-вот придут, — честное «не удалось» и
 * кнопка, начинающая новую попытку.
 */
export function LoadFailed({ message, onRetry }: LoadFailedProps) {
  return (
    <View style={styles.container} testID="load-failed">
      <Text color="textSecondary" style={styles.message}>
        {message}
      </Text>
      <Button label="Повторить" variant="secondary" onPress={onRetry} />
    </View>
  );
}
