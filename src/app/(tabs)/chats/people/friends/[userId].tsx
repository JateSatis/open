import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { FriendsList } from '@/features/friends/FriendsList';

/** Друзья человека, открытые из его профиля в стеке «Чатов». */
export default function ChatPersonFriendsScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Друзья' }} />
      <FriendsList
        userId={userId}
        onOpenPerson={(personId) =>
          router.push({ pathname: '/chats/people/[userId]', params: { userId: personId } })
        }
      />
    </Screen>
  );
}
