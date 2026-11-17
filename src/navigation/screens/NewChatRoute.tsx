import { useRouteParams, useRouter } from '@/navigation';

import { NewChatScreen } from '@/features/chats/NewChatScreen';

export function NewChatRoute() {
  const { with: initialUserId } = useRouteParams<'NewChat'>();
  const router = useRouter();

  return (
    <NewChatScreen
      initialUserId={initialUserId}
      onOpenChat={(chatId) => router.replace({ name: 'Chat', params: { chatId } })}
      onOpenRequest={(userId) => router.replace({ name: 'Request', params: { userId } })}
    />
  );
}
