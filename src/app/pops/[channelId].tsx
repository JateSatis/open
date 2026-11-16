import { useLocalSearchParams } from 'expo-router';

import { PopViewerScreen } from '@/features/pops/PopViewerScreen';

export default function PopViewerRoute() {
  const { channelId, start, from } = useLocalSearchParams<{
    channelId: string;
    start: string;
    /** Откуда открыли — для журнала рекомендаций. */
    from?: string;
  }>();

  return (
    <PopViewerScreen source="channel" channelId={channelId} startId={start} entry={from} />
  );
}
