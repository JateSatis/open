import { useLocalSearchParams } from 'expo-router';

import { ChannelPopViewer } from '@/features/pops/PopViewer/ChannelPopViewer';

export default function PopViewerRoute() {
  const { channelId, start, from } = useLocalSearchParams<{
    channelId: string;
    start: string;
    /** Откуда открыли — для журнала рекомендаций. */
    from?: string;
  }>();

  return (
    <ChannelPopViewer
      channelId={channelId}
      startId={start}
      entry={from ?? 'channel_grid'}
    />
  );
}
