import { useLocalSearchParams } from 'expo-router';

import { SubscribersScreen } from '@/features/channels/SubscribersScreen';

export default function ChannelSubscribersRoute() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();

  return <SubscribersScreen target={{ kind: 'channel', id: channelId }} />;
}
