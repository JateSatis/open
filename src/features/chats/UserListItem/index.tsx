import { ActivityIndicator, Pressable, View } from 'react-native';

import { styles } from './styles';

import type { DirectCandidate } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type UserListItemProps = {
  user: DirectCandidate;
  isOnline: boolean;
  isOpening: boolean;
  onPress: (userId: string) => void;
};

/** Человек, с которым переписки ещё нет: нажатие заводит диалог и открывает его. */
export function UserListItem({ user, isOnline, isOpening, onPress }: UserListItemProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Написать: ${user.displayName}`}
      accessibilityState={{ disabled: isOpening }}
      disabled={isOpening}
      onPress={() => onPress(user.id)}
      style={styles.row}
    >
      <Avatar uri={user.avatarUrl} name={user.displayName} />

      <View style={styles.body}>
        <Text variant="bodyBold" numberOfLines={1}>
          {user.displayName}
        </Text>

        <View style={styles.status}>
          {isOnline ? <View style={[styles.onlineDot, { backgroundColor: theme.success }]} /> : null}
          <Text variant="caption" color="textSecondary">
            {isOnline ? 'в сети' : 'написать первым'}
          </Text>
        </View>
      </View>

      {isOpening ? <ActivityIndicator accessibilityLabel="Открываю диалог" /> : null}
    </Pressable>
  );
}
