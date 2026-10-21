import { Redirect } from 'expo-router';

import { useSession } from '@/features/auth/useSession';
import { useBirthDateGate } from '@/features/privacy/queries';

export default function Index() {
  const { isAuthenticated, isLoading } = useSession();
  const gate = useBirthDateGate();

  // Redirecting before the persisted session is read would flash the sign-in
  // screen at every cold start of an already signed-in user.
  if (isLoading || (isAuthenticated && gate === 'loading')) {
    return null;
  }

  if (!isAuthenticated) return <Redirect href="/(auth)/sign-in" />;

  return <Redirect href={gate === 'required' ? '/birth-date' : '/(tabs)/chats'} />;
}
