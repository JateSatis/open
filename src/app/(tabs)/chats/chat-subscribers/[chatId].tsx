import { useLocalSearchParams } from 'expo-router';

import { SubscribersScreen } from '@/features/channels/SubscribersScreen';

export default function ChatSubscribersRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  return <SubscribersScreen target={{ kind: 'chat', id: chatId }} />;
}
