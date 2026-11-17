import { useRouteParams } from '@/navigation';

import { ChannelScreen } from '@/features/channels/ChannelScreen';
import { initialSectionOf, sectionRequestOf } from '@/features/channels/sectionRequest';

export function ChannelRoute() {
  const params = useRouteParams<'Channel'>();

  return (
    <ChannelScreen
      channelId={params.channelId}
      section={initialSectionOf(params)}
      sectionRequest={sectionRequestOf(params)}
    />
  );
}
