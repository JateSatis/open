import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/useSession';
import { BirthDateScreen } from '@/features/privacy/BirthDateScreen';
import { useBirthDateGate } from '@/features/privacy/queries';

export default function BirthDateRoute() {
  const { isAuthenticated, isLoading } = useSession();
  const gate = useBirthDateGate();

  if (isLoading || (isAuthenticated && gate === 'loading')) return null;
  if (!isAuthenticated) return <Redirect href="/(auth)/sign-in" />;
  // Дата уже есть — экран больше не показывается никогда.
  if (gate === 'ok') return <Redirect href="/(tabs)/chats" />;

  return <BirthDateScreen />;
}
