import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { MyFriends } from '@/features/friends/MyFriends';

/** Свои друзья и входящие заявки — из своего профиля. */
export default function MyFriendsScreen() {
  const router = useRouter();
  const userId = useCurrentUserId();

  if (!userId) return null;

  return (
    <Screen edges={['bottom']}>
      <MyFriends
        userId={userId}
        onOpenPerson={(personId) =>
          router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
        }
      />
    </Screen>
  );
}
