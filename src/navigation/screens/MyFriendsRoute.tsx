import { useRouter } from '@/navigation';

import { MyFriendsScreen } from '@/features/friends/MyFriendsScreen';

/** Свои друзья и входящие заявки — из своего профиля. */
export function MyFriendsRoute() {
  const router = useRouter();

  return (
    <MyFriendsScreen
      onOpenPerson={(personId) => router.push({ name: 'Person', params: { userId: personId } })}
    />
  );
}
