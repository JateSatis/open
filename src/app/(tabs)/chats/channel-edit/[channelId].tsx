import { useLocalSearchParams } from 'expo-router';

import { ChannelEditScreen } from '@/features/channels/ChannelEditScreen';

export default function ChannelEditRoute() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();

  return <ChannelEditScreen channelId={channelId} />;
}
