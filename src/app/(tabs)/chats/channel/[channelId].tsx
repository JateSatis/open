import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';

export default function ChannelRoute() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();

  return <ChannelScreen channelId={channelId} />;
}
