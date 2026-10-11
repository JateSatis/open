import { useQuery } from '@tanstack/react-query';

import { getChannel } from '@/api/channels';
import { channelQueryKey } from '@/features/channels/keys';

export { channelQueryKey };

export function useChannel(channelId: string | undefined) {
  return useQuery({
    queryKey: channelQueryKey(channelId ?? ''),
    queryFn: () => getChannel(channelId!),
    enabled: Boolean(channelId),
  });
}
