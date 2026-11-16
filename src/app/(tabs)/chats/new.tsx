import { useLocalSearchParams, useRouter } from 'expo-router';

import { NewChatScreen } from '@/features/chats/NewChatScreen';

export default function NewChatRoute() {
  const { with: initialUserId } = useLocalSearchParams<{ with?: string }>();
  const router = useRouter();

  return (
    <NewChatScreen
      initialUserId={initialUserId}
      onOpenChat={(chatId) => router.replace(`/chats/${chatId}`)}
      onOpenRequest={(userId) =>
        router.replace({ pathname: '/chats/request/[userId]', params: { userId } })
      }
    />
  );
}
