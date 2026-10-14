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
  /** Под именем: «в сети» — акцентом, «был(а) …» — приглушённо. */
  status?: { text: string; accent?: boolean } | null;
  /**
   * Выбрать нельзя — и почему, справа вместо отметки: «в группе»,
   * «приглашён(а)». Нажатие ничего не делает.
   */
  unavailable?: string | null;
};

/** Человек в списке выбора: нажатие отмечает или снимает отметку, действие — у кнопки экрана. */
export function PersonPickItem({
  person,
  isSelected,
  onToggle,
  status = null,
  unavailable = null,
}: PersonPickItemProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="person-pick"
      accessibilityRole="checkbox"
      accessibilityLabel={person.displayName}
      accessibilityState={{ checked: isSelected, disabled: unavailable !== null }}
      disabled={unavailable !== null}
      onPress={() => onToggle(person.id)}
      style={styles.row}
    >
      <Avatar uri={person.avatarUrl} name={person.displayName} />

      <View style={styles.name}>
        <Text variant="bodyBold" numberOfLines={1}>
          {person.displayName}
        </Text>
        {status ? (
          <Text
            variant="small"
            color={status.accent ? 'primary' : 'textSecondary'}
            numberOfLines={1}
          >
            {status.text}
          </Text>
        ) : null}
      </View>

      {unavailable ? (
        <Text variant="caption" color="textSecondary">
          {unavailable}
        </Text>
      ) : (
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
      )}
    </Pressable>
  );
}
