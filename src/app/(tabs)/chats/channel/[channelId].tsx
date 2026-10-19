import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';
import {
  initialSectionOf,
  sectionRequestOf,
  type ChannelRouteParams,
} from '@/features/channels/sectionRequest';

export default function ChannelRoute() {
  const params = useLocalSearchParams<{ channelId: string } & ChannelRouteParams>();

  return (
    <ChannelScreen
      channelId={params.channelId}
      section={initialSectionOf(params)}
      sectionRequest={sectionRequestOf(params)}
    />
  );
}
