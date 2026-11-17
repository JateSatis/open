import { router } from '@/navigation';

import { AccountScreen } from '@/features/auth/AccountScreen';

export function AccountRoute() {
  return <AccountScreen onOpenPrivacy={() => router.push({ name: 'Privacy' })} />;
}
