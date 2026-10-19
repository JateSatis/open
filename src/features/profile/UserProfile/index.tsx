import { Stack, useRouter } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { useProfile } from '@/features/profile/queries';

/**
 * Чужой профиль. Один экран на две вкладки: из переписки он открывается
 * внутри «Чатов», чтобы «назад» возвращал в чат, а не в свой профиль.
 * `stack` — в каком стеке открыт: туда же кладутся его «Диалоги».
 *
 * Загруженный профиль — без шапки стека: фото во всю ширину, «назад» на нём.
 * Пока грузится или не загрузился — обычная шапка, чтобы было куда уйти.
 */
export function UserProfile({ userId, stack }: { userId: string; stack: 'chats' | 'profile' }) {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const { data: profile, isPending, error, refetch } = useProfile(userId);
  const isMe = currentUserId !== null && userId === currentUserId;

  if (!profile) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ headerShown: true, title: 'Профиль' }} />
        <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
          {null}
        </ProfileLoader>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProfilePage
        profile={profile}
        onBack={() => router.back()}
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
    </>
  );
}
