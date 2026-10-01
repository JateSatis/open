import { useLocalSearchParams } from 'expo-router';

import { UserProfile } from '@/features/profile/UserProfile';

/** Профиль человека, открытый из переписки: живёт в стеке «Чатов». */
export default function ChatPersonScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return <UserProfile userId={userId} stack="chats" />;
}
