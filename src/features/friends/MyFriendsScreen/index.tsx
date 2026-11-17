import { useRouter } from '@/navigation';
import { Screen } from '@/components/Screen';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { MyFriends } from '@/features/friends/MyFriends';

export function MyFriendsScreen() {
  const router = useRouter();
  const onOpenPerson = (userId: string) => router.push({ name: 'Person', params: { userId } });
  const userId = useCurrentUserId();

  if (!userId) return null;

  return (
    <Screen edges={['bottom']}>
      <MyFriends userId={userId} onOpenPerson={onOpenPerson} />
    </Screen>
  );
}
