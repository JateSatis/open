import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';
import { jumpRequestOf, type JumpParams } from '@/features/chats/jumpParams';

export default function ChannelRoute() {
  const params = useLocalSearchParams<{ channelId: string; section?: string } & JumpParams>();
  // Переход к посту из другого чата: сами прыжок и шит исполняют «Посты» по
  // этим же параметрам, экрану канала — лишь открыть этот раздел.
  const postsRequest = params.jumpTo || params.comments ? jumpRequestOf(params) : undefined;

  return (
    <ChannelScreen
      channelId={params.channelId}
      section={params.section === 'pops' ? 'pops' : 'posts'}
      postsRequest={postsRequest}
    />
  );
}
