import { useRouter } from 'expo-router';
import { useCallback } from 'react';

const routes = {
  chats: {
    friends: '/chats/people/friends/[userId]',
    dialogs: '/chats/people/dialogs/[userId]',
    root: '/chats',
  },
  profile: {
    friends: '/profile/friends/[userId]',
    dialogs: '/profile/dialogs/[userId]',
    root: '/profile',
  },
} as const;

export function useUserProfileNavigation(userId: string, origin: keyof typeof routes) {
  const router = useRouter();
  const { friends, dialogs, root } = routes[origin];
  const onBackFallback = useCallback(() => router.replace(root), [router, root]);

  return {
    onOpenFriends: (isMe: boolean) => {
      if (isMe) router.navigate('/profile/friends');
      else router.push({ pathname: friends, params: { userId } });
    },
    onOpenDialogs: () => router.push({ pathname: dialogs, params: { userId } }),
    onWrite: () => router.push({ pathname: '/chats/new', params: { with: userId } }),
    onBackFallback,
  };
}
