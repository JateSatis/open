import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { ProfileView } from '@/features/profile/ProfileView';
import { useProfile } from '@/features/profile/queries';
import { displayNameOf } from '@/features/profile/username';
import { Spacing } from '@/theme';

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
  },
});

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { data: profile, isPending, error, refetch } = useProfile(userId);

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: profile ? displayNameOf(profile) : 'Профиль' }} />

      <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
        {profile ? (
          <ProfileView
            profile={profile}
            actions={
              <Text variant="small" color="textSecondary">
                Переписка этого человека открыта — её можно читать из ленты и поиска.
              </Text>
            }
          />
        ) : null}
      </ProfileLoader>
    </Screen>
  );
}
