import { PopViewer } from '.';

import { usePopFeed } from '@/features/pops/usePopFeed';

export type ChannelPopViewerProps = {
  channelId: string;
  startId: string;
  /** Откуда открыли — точка входа показа в журнале. */
  entry?: string;
};

/** Просмотр попсов канала из сетки, начиная с выбранного попа. */
export function ChannelPopViewer({ channelId, startId, entry }: ChannelPopViewerProps) {
  const feed = usePopFeed(channelId, startId);
  return <PopViewer feed={feed} startId={startId} channelLink="under" surface="channel" entry={entry} />;
}
