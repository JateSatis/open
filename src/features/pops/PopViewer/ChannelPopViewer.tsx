import { PopViewer } from '.';

import { usePopFeed } from '@/features/pops/usePopFeed';

export type ChannelPopViewerProps = {
  channelId: string;
  startId: string;
  openComments?: boolean;
  focusCommentId?: string;
  /** Откуда открыли — точка входа показа в журнале. */
  entry?: string;
};

/**
 * Просмотр попсов канала — из сетки, поста и пересланного поста: лента
 * канала от выбранного попа, выше новее, ниже старше. Имя канала ведёт
 * назад к каналу под просмотром.
 */
export function ChannelPopViewer({ channelId, startId, ...rest }: ChannelPopViewerProps) {
  const feed = usePopFeed(channelId, startId);

  return <PopViewer feed={feed} startId={startId} channelLink="under" surface="channel" {...rest} />;
}
