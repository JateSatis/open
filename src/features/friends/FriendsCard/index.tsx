import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { InfoCard } from '@/components/InfoPage';
import { Text } from '@/components/Text';
import { useFriendsSummary } from '@/features/friends/queries';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes } from '@/theme';

/** Больше — «99+». */
const BADGE_MAX = 99;

export type FriendsCardProps = {
  userId: string;
  onPress: () => void;
};

/**
 * Строка «Друзья» в профиле. Список закрыт настройкой его владельца — строки
 * нет вовсе (сервер его и не отдаст). В своём профиле — счётчик входящих
 * заявок.
 */
export function FriendsCard({ userId, onPress }: FriendsCardProps) {
  const theme = useTheme();
  const { data } = useFriendsSummary(userId);

  if (!data?.listVisible) return null;

  const incoming = data.incomingCount ?? 0;
  const label =
    incoming > 0 ? `Друзья, новых заявок: ${incoming}` : `Друзья: ${data.friendsCount ?? 0}`;

  return (
    <InfoCard testID="profile-friends-card">
      <Pressable
        testID="profile-friends"
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <SymbolView
          name={{ ios: 'person.2', android: 'group', web: 'group' }}
          size={InfoPageSizes.barIcon}
          tintColor={theme.primary}
        />
        <Text variant="body" style={styles.label}>
          Друзья
        </Text>
        {incoming > 0 ? (
          <View
            testID="profile-friends-requests"
            style={[styles.badge, { backgroundColor: theme.primary }]}
          >
            <Text variant="captionBold" color="primaryText">
              {incoming > BADGE_MAX ? `${BADGE_MAX}+` : incoming}
            </Text>
          </View>
        ) : null}
        <Text variant="body" color="textSecondary">
          {data.friendsCount ?? 0}
        </Text>
      </Pressable>
    </InfoCard>
  );
}
