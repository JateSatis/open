import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { ProfileView } from '@/features/profile/ProfileView';
import { useMyProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { Radii, Spacing } from '@/theme';

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
  },
  onboarding: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radii.md,
  },
});

export default function MyProfileScreen() {
  const { data: profile, isPending, error, refetch } = useMyProfile();
  const theme = useTheme();

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
        {profile ? (
          <>
            {profile.username === null ? (
              <View style={[styles.onboarding, { backgroundColor: theme.backgroundElement }]}>
                <Text variant="bodyBold">Имя пользователя не задано</Text>
                <Text variant="small" color="textSecondary">
                  По нему вас найдут в поиске и упомянут в чужой переписке. Ваши сообщения видны
                  всем и без него.
                </Text>
                <Button
                  label="Придумать имя"
                  onPress={() => router.push('/(tabs)/profile/edit')}
                />
              </View>
            ) : null}

            <ProfileView
              profile={profile}
              actions={
                <Button
                  label="Редактировать профиль"
                  variant="secondary"
                  onPress={() => router.push('/(tabs)/profile/edit')}
                />
              }
            />
          </>
        ) : null}
      </ProfileLoader>
    </Screen>
  );
}
