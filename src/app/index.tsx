import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/useSession';

export default function Index() {
  const { isAuthenticated } = useSession();

  return <Redirect href={isAuthenticated ? '/(tabs)/chats' : '/(auth)/sign-in'} />;
}
