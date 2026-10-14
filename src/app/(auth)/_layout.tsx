import { Redirect, Stack, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useSession } from '@/features/auth/useSession';
import { getPendingLink, setPendingLink } from '@/store/pendingLink';

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useSession();

  // Ссылка исполняется один раз: забыть её, когда по ней ушли.
  useEffect(() => {
    if (isAuthenticated) setPendingLink(null);
  }, [isAuthenticated]);

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    // Вошли по ссылке на канал — к нему, а не в «Чаты».
    return <Redirect href={(getPendingLink() as Href | null) ?? '/(tabs)/chats'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
