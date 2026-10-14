import { useLocalSearchParams } from 'expo-router';

import { ChannelInfoScreen } from '@/features/channels/ChannelInfoScreen';

export default function ChannelInfoRoute() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();

  return <ChannelInfoScreen channelId={channelId} />;
}
