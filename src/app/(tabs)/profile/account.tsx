import { router } from 'expo-router';

import { AccountScreen } from '@/features/auth/AccountScreen';

export default function AccountRoute() {
  return <AccountScreen onOpenPrivacy={() => router.push('/profile/privacy')} />;
}
