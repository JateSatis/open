import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Person } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type PersonPickItemProps = {
  person: Person;
  isSelected: boolean;
  isOnline: boolean;
  onToggle: (personId: string) => void;
};

/** Человек в списке выбора: нажатие отмечает или снимает отметку, чат создаёт кнопка. */
export function PersonPickItem({ person, isSelected, isOnline, onToggle }: PersonPickItemProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={person.displayName}
      accessibilityState={{ checked: isSelected }}
      onPress={() => onToggle(person.id)}
      style={styles.row}
    >
      <Avatar uri={person.avatarUrl} name={person.displayName} />

      <View style={styles.body}>
        <Text variant="bodyBold" numberOfLines={1}>
          {person.displayName}
        </Text>

        {isOnline ? (
          <View style={styles.status}>
            <View style={[styles.onlineDot, { backgroundColor: theme.success }]} />
            <Text variant="caption" color="textSecondary">
              в сети
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.check,
          isSelected
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { borderColor: theme.border },
        ]}
      >
        {isSelected ? (
          <Text variant="smallBold" style={{ color: theme.primaryText }}>
            ✓
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
