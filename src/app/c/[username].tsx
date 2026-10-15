import { useLocalSearchParams } from 'expo-router';

import { ChannelLinkScreen } from '@/features/channels/ChannelLinkScreen';

/** Ссылка на канал `openger://c/<имя>`: находит канал и подменяет себя его экраном. */
export default function ChannelLinkRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return <ChannelLinkScreen username={username ?? ''} />;
}
