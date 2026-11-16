import { useLocalSearchParams, useRouter } from 'expo-router';

import { FriendsList } from '@/features/friends/FriendsList';

/** Друзья другого человека, открытые из его профиля в стеке «Профиля». */
export default function UserFriendsScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return (
    <FriendsList
      userId={userId}
      onOpenPerson={(personId) =>
        router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
      }
    />
  );
}
