import { useLocalSearchParams } from 'expo-router';

import { ChannelPopViewer } from '@/features/pops/PopViewer/ChannelPopViewer';

export default function PopViewerRoute() {
  const { channelId, start, comments, comment, commentRoot, commentKey, from } = useLocalSearchParams<{
    channelId: string;
    start: string;
    /** `1` — сразу с открытыми комментариями к стартовому попу. */
    comments?: string;
    /** Комментарий, к которому пришли: наверху и подсвечен. */
    comment?: string;
    commentRoot?: string;
    commentKey?: string;
    /** Откуда открыли — для журнала рекомендаций. */
    from?: string;
  }>();

  return (
    <ChannelPopViewer
      channelId={channelId}
      startId={start}
      openComments={comments === '1'}
      focusCommentId={comment}
      focusRootId={commentRoot}
      focusRequestId={commentKey}
      entry={from ?? 'post'}
    />
  );
}
