import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { CreatedChannel } from '@/api/channels';
import { NewChannelForm } from '@/features/channels/NewChannelForm';

/** Создание канала. Готовый канал заменяет этот экран: «назад» ведёт в список чатов. */
export default function NewChannelScreen() {
  const router = useRouter();
  const onCreated = useCallback(
    ({ channelId }: CreatedChannel) => router.replace(`/chats/channel/${channelId}`),
    [router],
  );

  return <NewChannelForm onCreated={onCreated} />;
}
