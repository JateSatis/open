import { useLocalSearchParams } from 'expo-router';

import { UserProfile } from '@/features/profile/UserProfile';
import { useUserProfileNavigation } from '@/features/profile/UserProfile/useUserProfileNavigation';

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const actions = useUserProfileNavigation(userId, 'profile');

  return <UserProfile userId={userId} {...actions} />;
}
