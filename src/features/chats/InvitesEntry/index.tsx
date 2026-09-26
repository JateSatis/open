import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type InvitesEntryProps = {
  incomingCount: number;
  onPress: () => void;
};

/** Строка над чатами: ведёт к заявкам, счётчик — сколько ждут ответа. */
export function InvitesEntry({ incomingCount, onPress }: InvitesEntryProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={incomingCount > 0 ? `Заявки: ${incomingCount}` : 'Заявки'}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border }]}
    >
      <Text variant="bodyBold" style={styles.title}>
        Заявки
      </Text>

      {incomingCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.primary }]}>
          <Text variant="smallBold" style={{ color: theme.primaryText }}>
            {incomingCount}
          </Text>
        </View>
      ) : null}

      <Text variant="body" color="textSecondary">
        ›
      </Text>
    </Pressable>
  );
}
