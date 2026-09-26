import { useLocalSearchParams } from 'expo-router';

import { UserProfile } from '@/features/profile/UserProfile';

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return <UserProfile userId={userId} />;
}
