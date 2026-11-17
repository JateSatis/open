import { useRouteParams } from '@/navigation';

import { ChannelEditScreen } from '@/features/channels/ChannelEditScreen';

export function ChannelEditRoute() {
  const { channelId } = useRouteParams<'ChannelEdit'>();

  return <ChannelEditScreen channelId={channelId} />;
}
