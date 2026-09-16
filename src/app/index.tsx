import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/useSession';

export default function Index() {
  const { isAuthenticated, isLoading } = useSession();

  // Redirecting before the persisted session is read would flash the sign-in
  // screen at every cold start of an already signed-in user.
  if (isLoading) {
    return null;
  }

  return <Redirect href={isAuthenticated ? '/(tabs)/chats' : '/(auth)/sign-in'} />;
}
