import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';
import type { ChatSearchParams } from '@/features/chats/chatSearch/useChatSearch';
import { jumpRequestOf, type JumpParams } from '@/features/chats/jumpParams';

export default function ChannelRoute() {
  const params = useLocalSearchParams<
    { channelId: string; section?: string } & JumpParams & ChatSearchParams
  >();
  // Переход к посту из другого чата или поиск по постам со страницы канала:
  // сами прыжок, шит и поиск исполняют «Посты» по этим же параметрам, экрану
  // канала — лишь открыть этот раздел.
  const postsRequest =
    jumpRequestOf(params) ?? (params.search === '1' ? params.searchKey : undefined);

  return (
    <ChannelScreen
      channelId={params.channelId}
      section={params.section === 'pops' ? 'pops' : 'posts'}
      postsRequest={postsRequest}
    />
  );
}
