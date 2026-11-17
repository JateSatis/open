import { router } from '@/navigation';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { InfoBarButton } from '@/components/InfoPage';
import { Screen } from '@/components/Screen';
import { TabBar, useTabBarHeight } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { ConnectionBanner } from '@/features/connection/ConnectionBanner';
import { FriendsCard } from '@/features/friends/FriendsCard';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { useMyProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Radii, Spacing } from '@/theme';

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  onboarding: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radii.md,
  },
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});

export function MyProfileScreen() {
  const { data: profile, isPending, error, refetch } = useMyProfile();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {profile ? (
        <ProfilePage
          profile={profile}
          bottomInset={tabBarHeight}
          barRight={
            <InfoBarButton
              testID="profile-settings"
              icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              accessibilityLabel="Аккаунт"
              onPress={() => router.push({ name: 'Account' })}
            />
          }
          lead={
            profile.username === null ? (
              <View style={[styles.onboarding, { backgroundColor: theme.backgroundElement }]}>
                <Text variant="bodyBold">Имя пользователя не задано</Text>
                <Text variant="small" color="textSecondary">
                  По нему вас найдут в поиске и упомянут в чужой переписке. Ваши сообщения видны
                  всем и без него.
                </Text>
                <Button
                  label="Придумать имя"
                  onPress={() => router.push({ name: 'EditProfile' })}
                />
              </View>
            ) : null
          }
          extraCards={
            <FriendsCard userId={profile.id} onPress={() => router.push({ name: 'MyFriends' })} />
          }
          actions={
            <Button
              label="Редактировать профиль"
              variant="secondary"
              onPress={() => router.push({ name: 'EditProfile' })}
            />
          }
        />
      ) : (
        <Screen edges={['top']}>
          <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
            {null}
          </ProfileLoader>
        </Screen>
      )}

      {/* Обрыв связи — полоской под панелью поверх фото: шапки у профиля нет. */}
      <ConnectionBanner style={[styles.banner, { top: insets.top + InfoPageSizes.barHeight }]} />
      <TabBar active="profile" />
    </View>
  );
}
