import { useLocalSearchParams } from 'expo-router';

import { ChannelScreen } from '@/features/channels/ChannelScreen';

export default function ChannelRoute() {
  const { channelId, section } = useLocalSearchParams<{ channelId: string; section?: string }>();

  return <ChannelScreen channelId={channelId} section={section === 'pops' ? 'pops' : 'posts'} />;
}
