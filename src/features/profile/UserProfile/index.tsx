import { Stack, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
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

/**
 * Чужой профиль. Один экран на две вкладки: из переписки он открывается
 * внутри «Чатов», чтобы «назад» возвращал в чат, а не в свой профиль.
 * `stack` — в каком стеке открыт: туда же кладутся его «Диалоги».
 */
export function UserProfile({ userId, stack }: { userId: string; stack: 'chats' | 'profile' }) {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const { data: profile, isPending, error, refetch } = useProfile(userId);
  const isMe = currentUserId !== null && userId === currentUserId;

  return (
    <Screen scrollable edges={['bottom']} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: profile ? displayNameOf(profile) : 'Профиль' }} />

      <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
        {profile ? (
          <ProfileView
            profile={profile}
            actions={
              isMe ? null : (
                <>
                  <Button
                    label="Написать"
                    onPress={() =>
                      router.push({ pathname: '/chats/new', params: { with: profile.id } })
                    }
                  />
                  <Button
                    label="Диалоги"
                    variant="secondary"
                    onPress={() =>
                      router.push({
                        pathname:
                          stack === 'chats'
                            ? '/chats/people/dialogs/[userId]'
                            : '/profile/dialogs/[userId]',
                        params: { userId: profile.id },
                      })
                    }
                  />
                </>
              )
            }
          />
        ) : null}
      </ProfileLoader>
    </Screen>
  );
}
