import { useQuery } from '@tanstack/react-query';

import { getChannel } from '@/api/channels';

export const channelQueryKey = (channelId: string) => ['channel', channelId] as const;

export function useChannel(channelId: string | undefined) {
  return useQuery({
    queryKey: channelQueryKey(channelId ?? ''),
    queryFn: () => getChannel(channelId!),
    enabled: Boolean(channelId),
  });
}
