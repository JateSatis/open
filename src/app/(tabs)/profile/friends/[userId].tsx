import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { FriendsList } from '@/features/friends/FriendsList';

/** Друзья другого человека, открытые из его профиля в стеке «Профиля». */
export default function UserFriendsScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return (
    <Screen edges={['bottom']}>
      <FriendsList
        userId={userId}
        onOpenPerson={(personId) =>
          router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
        }
      />
    </Screen>
  );
}
