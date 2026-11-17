import { useRouteParams, useRouter } from '@/navigation';

import { FriendsList } from '@/features/friends/FriendsList';

export function FriendsRoute() {
  const router = useRouter();
  const { userId } = useRouteParams<'Friends'>();

  return (
    <FriendsList
      userId={userId}
      onOpenPerson={(personId) => router.push({ name: 'Person', params: { userId: personId } })}
    />
  );
}
