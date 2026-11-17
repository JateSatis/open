import { useRouter } from 'expo-router';

import { MyFriendsScreen } from '@/features/friends/MyFriendsScreen';

/** Свои друзья и входящие заявки — из своего профиля. */
export default function MyFriendsRoute() {
  const router = useRouter();

  return (
    <MyFriendsScreen
      onOpenPerson={(personId) =>
        router.push({ pathname: '/profile/[userId]', params: { userId: personId } })
      }
    />
  );
}
