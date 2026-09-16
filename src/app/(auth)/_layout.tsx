import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/features/auth/useSession';

export default function AuthLayout() {
  const { isAuthenticated } = useSession();

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/chats" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
