import { useLocalSearchParams } from 'expo-router';

import { UserChats } from '@/features/profile/UserChats';

/** Диалоги человека, открытые из его профиля в стеке «Чатов». */
export default function ChatPersonChatsScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return <UserChats userId={userId} />;
}
