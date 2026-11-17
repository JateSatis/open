import { useRouteParams } from '@/navigation';

import { UserProfile } from '@/features/profile/UserProfile';
import { useUserProfileNavigation } from '@/features/profile/UserProfile/useUserProfileNavigation';

export function PersonRoute() {
  const { userId } = useRouteParams<'Person'>();
  const actions = useUserProfileNavigation(userId);

  return <UserProfile userId={userId} {...actions} />;
}
