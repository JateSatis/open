import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { FriendPerson } from '@/api/friends';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { displayNameOf, formatUsername } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes } from '@/theme';

export type FriendRowProps = {
  person: FriendPerson;
  onPress: (userId: string) => void;
  /** Справа: «Принять» и «Отклонить» у заявки. */
  actions?: ReactNode;
};

/** Человек в списке друзей или заявок: аватарка, имя, @имя. Тап — профиль. */
export function FriendRow({ person, onPress, actions }: FriendRowProps) {
  const theme = useTheme();
  const name = displayNameOf(person);
  const username = formatUsername(person.username);

  return (
    <View style={styles.row}>
      <Pressable
        testID={`friend-row-${person.id}`}
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={() => onPress(person.id)}
        style={({ pressed }) => [
          styles.person,
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <Avatar uri={person.avatarUrl} name={name} size={InfoPageSizes.rowAvatar} />
        <View style={styles.text}>
          <Text variant="bodyBold" numberOfLines={1}>
            {name}
          </Text>
          {username ? (
            <Text variant="small" color="textSecondary" numberOfLines={1}>
              {username}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}
