import { PopViewer } from '.';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { usePopFeed } from '@/features/pops/usePopFeed';
import { prefetchCommentFocus } from '@/features/interactions/comments/prefetchCommentFocus';

export type ChannelPopViewerProps = {
  channelId: string;
  startId: string;
  openComments?: boolean;
  focusCommentId?: string;
  focusRootId?: string;
  focusRequestId?: string;
  /** Откуда открыли — точка входа показа в журнале. */
  entry?: string;
};

/**
 * Просмотр попсов канала — из сетки, поста и пересланного поста: лента
 * канала от выбранного попа, выше новее, ниже старше. Имя канала ведёт
 * назад к каналу под просмотром.
 */
export function ChannelPopViewer({
  channelId,
  startId,
  focusCommentId,
  focusRootId,
  ...rest
}: ChannelPopViewerProps) {
  const queryClient = useQueryClient();
  const feed = usePopFeed(channelId, startId);

  useEffect(() => {
    if (focusCommentId) {
      prefetchCommentFocus(queryClient, startId, focusCommentId, focusRootId);
    }
  }, [focusCommentId, focusRootId, queryClient, startId]);

  return <PopViewer
    feed={feed}
    startId={startId}
    focusCommentId={focusCommentId}
    focusRootId={focusRootId}
    channelLink="under"
    surface="channel"
    {...rest}
  />;
}
