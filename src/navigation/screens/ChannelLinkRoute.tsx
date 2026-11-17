import { useRouteParams } from '@/navigation';

import { ChannelLinkScreen } from '@/features/channels/ChannelLinkScreen';

/** Ссылка на канал `openger://c/<имя>`: находит канал и подменяет себя его экраном. */
export function ChannelLinkRoute() {
  const { username } = useRouteParams<'ChannelLink'>();

  return <ChannelLinkScreen username={username ?? ''} />;
}
