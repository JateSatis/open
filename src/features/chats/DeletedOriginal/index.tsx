import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

/**
 * Облачко островка, чей оригинал удалили: островок не рассыпается, на месте
 * сообщения — заглушка. Без реакций и комментариев: их было к чему ставить,
 * пока оригинал жил.
 */
export function DeletedOriginal() {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.avatarSlot} />
      <View
        testID="deleted-original"
        style={[styles.bubble, { backgroundColor: theme.backgroundElement }]}
      >
        <Text variant="small" color="textSecondary">
          Сообщение удалено
        </Text>
      </View>
    </View>
  );
}
