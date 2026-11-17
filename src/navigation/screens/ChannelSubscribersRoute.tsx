import { useRouteParams } from '@/navigation';

import { SubscribersScreen } from '@/features/channels/SubscribersScreen';

export function ChannelSubscribersRoute() {
  const { channelId } = useRouteParams<'ChannelSubscribers'>();

  return <SubscribersScreen target={{ kind: 'channel', id: channelId }} />;
}
