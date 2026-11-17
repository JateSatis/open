import { Screen } from '@/components/Screen';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { MyFriends, type MyFriendsProps } from '@/features/friends/MyFriends';

type MyFriendsScreenProps = Pick<MyFriendsProps, 'onOpenPerson'>;

export function MyFriendsScreen({ onOpenPerson }: MyFriendsScreenProps) {
  const userId = useCurrentUserId();

  if (!userId) return null;

  return (
    <Screen edges={['bottom']}>
      <MyFriends userId={userId} onOpenPerson={onOpenPerson} />
    </Screen>
  );
}
