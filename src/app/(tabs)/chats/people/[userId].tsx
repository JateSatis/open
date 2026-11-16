import { useLocalSearchParams } from 'expo-router';

import { UserProfile } from '@/features/profile/UserProfile';
import { useUserProfileNavigation } from '@/features/profile/UserProfile/useUserProfileNavigation';

/** Профиль человека, открытый из переписки: живёт в стеке «Чатов». */
export default function ChatPersonScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const actions = useUserProfileNavigation(userId, 'chats');

  return <UserProfile userId={userId} {...actions} />;
}
