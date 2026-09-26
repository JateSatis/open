import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Person } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type PersonPickItemProps = {
  person: Person;
  isSelected: boolean;
  onToggle: (personId: string) => void;
};

/**
 * Человек в списке выбора: нажатие отмечает или снимает отметку, чат создаёт
 * кнопка. «В сети» здесь нет намеренно: presence-канал держит экран «Чаты», который
 * остаётся смонтированным под этим, а второй подписчик на тот же топик
 * Realtime не допускает.
 */
export function PersonPickItem({ person, isSelected, onToggle }: PersonPickItemProps) {
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

      <Text variant="bodyBold" numberOfLines={1} style={styles.name}>
        {person.displayName}
      </Text>

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
