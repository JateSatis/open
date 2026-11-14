import { useQuery } from '@tanstack/react-query';

import { ChannelGoneError, getChannel, type Channel } from '@/api/channels';
import { channelQueryKey } from '@/features/channels/keys';

import { stillReader, useHistoryReader } from '@/features/chats/messages/local/reader';
import { localHistory } from '@/features/chats/messages/local/database';
import { routeOptions } from '@/features/chats/messages/local/route';

export { channelQueryKey };

export function useChannel(channelId: string | undefined) {
  const reader = useHistoryReader();
  return useQuery({
    queryKey: channelQueryKey(channelId ?? ''),
    ...routeOptions(reader, 'channel/' + channelId, async () => {
      try {
        return await getChannel(channelId!);
      } catch (error) {
        if (!(error instanceof ChannelGoneError)) throw error;
        if (reader && stillReader(reader)) {
          const db = localHistory();
          const old = db.route<Channel>(reader, 'channel/' + channelId);
          if (old) {
            db.forget({ reader, chat: old.postsChatId });
            db.setRoute(reader, 'chat/' + old.postsChatId, null);
          }
        }
        return null;
      }
    }),
    enabled: Boolean(channelId),
  });
}
