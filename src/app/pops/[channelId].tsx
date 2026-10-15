import { useLocalSearchParams } from 'expo-router';

import { ChannelPopViewer } from '@/features/pops/PopViewer/ChannelPopViewer';

export default function PopViewerRoute() {
  const { channelId, start, comments, comment } = useLocalSearchParams<{
    channelId: string;
    start: string;
    /** `1` — сразу с открытыми комментариями к стартовому попу. */
    comments?: string;
    /** Комментарий, к которому пришли: наверху и подсвечен. */
    comment?: string;
  }>();

  return (
    <ChannelPopViewer
      channelId={channelId}
      startId={start}
      openComments={comments === '1'}
      focusCommentId={comment}
    />
  );
}
