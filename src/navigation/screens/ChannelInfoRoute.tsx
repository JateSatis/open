import { useRouteParams } from '@/navigation';

import { ChannelInfoScreen } from '@/features/channels/ChannelInfoScreen';

export function ChannelInfoRoute() {
  const { channelId } = useRouteParams<'ChannelInfo'>();

  return <ChannelInfoScreen channelId={channelId} />;
}
