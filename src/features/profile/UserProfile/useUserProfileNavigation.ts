import { useRouter } from '@/navigation';
import { useCallback } from 'react';

export function useUserProfileNavigation(userId: string) {
  const router = useRouter();
  const onBackFallback = useCallback(
    () => router.replace({ name: 'Tabs', params: { screen: 'chats' } }),
    [router],
  );

  return {
    onOpenFriends: (isMe: boolean) => {
      if (isMe) router.navigate({ name: 'MyFriends' });
      else router.push({ name: 'Friends', params: { userId } });
    },
    onOpenDialogs: () => router.push({ name: 'Dialogs', params: { userId } }),
    onWrite: () => router.push({ name: 'NewChat', params: { with: userId } }),
    onBackFallback,
  };
}
