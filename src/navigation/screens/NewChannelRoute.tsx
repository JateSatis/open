import { useRouter } from '@/navigation';
import { useCallback } from 'react';

import type { CreatedChannel } from '@/api/channels';
import { NewChannelForm } from '@/features/channels/NewChannelForm';

export function NewChannelRoute() {
  const router = useRouter();
  const onCreated = useCallback(
    ({ channelId }: CreatedChannel) => router.replace({ name: 'Channel', params: { channelId } }),
    [router],
  );

  return <NewChannelForm onCreated={onCreated} />;
}
