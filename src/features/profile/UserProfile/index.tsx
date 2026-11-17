import { useUserProfileNavigation } from './useUserProfileNavigation';
import { useRouteParams } from '@/navigation';
import { Button } from '@/components/Button';
import { PlainPageBar } from '@/components/PageBar';
import { Screen } from '@/components/Screen';
import { SlidePage, useSlideBack } from '@/components/SlidePage';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { FriendButton } from '@/features/friends/FriendButton';
import { FriendsCard } from '@/features/friends/FriendsCard';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { PersonSafetyActions } from '@/features/moderation/PersonSafetyActions';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { useProfile } from '@/features/profile/queries';
import { displayNameOf } from '@/features/profile/username';

/**
 * Чужой профиль. Один экран на две вкладки: из переписки он открывается
 * внутри «Чатов», чтобы «назад» возвращал в чат, а не в свой профиль.
 *
 * Профиль — страница: въезжает справа и уезжает свайпом за пальцем туда,
 * откуда открыт. Загруженный — фото во всю ширину, «назад» на нём; пока
 * грузится или не загрузился — простая шапка, чтобы было куда уйти. Под ним
 * пусто (открыли ссылкой) — назад ведёт в корень вкладки.
 */
export function UserProfile() {
  const { userId } = useRouteParams<'Person'>();
  const { onOpenFriends, onOpenDialogs, onWrite, onBackFallback } = useUserProfileNavigation(userId);
  const currentUserId = useCurrentUserId();
  const { data: profile, isPending, error, refetch } = useProfile(userId);
  const isMe = currentUserId !== null && userId === currentUserId;
  // Одна на маршрут: заглушка и профиль въезжают и уходят одним движением.
  const slide = useSlideBack(onBackFallback);

  if (!profile) {
    return (
      <SlidePage slide={slide}>
        <PlainPageBar title="Профиль" onBack={slide.close} />
        <Screen edges={['bottom']}>
          <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
            {null}
          </ProfileLoader>
        </Screen>
      </SlidePage>
    );
  }

  return (
    <>
      <ProfilePage
        profile={profile}
        slideBack={slide}
        extraCards={
          <FriendsCard userId={profile.id} onPress={() => onOpenFriends(isMe)} />
        }
        actions={
          isMe ? null : (
            <>
              <FriendButton userId={profile.id} name={displayNameOf(profile)} />
              <Button label="Написать" onPress={onWrite} />
              <Button label="Диалоги" variant="secondary" onPress={onOpenDialogs} />
              <PersonSafetyActions userId={profile.id} name={displayNameOf(profile)} />
            </>
          )
        }
      />
    </>
  );
}
