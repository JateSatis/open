import { useLocalSearchParams } from 'expo-router';

import { PopViewer } from '@/features/pops/PopViewer';

export default function PopViewerRoute() {
  const { channelId, start } = useLocalSearchParams<{ channelId: string; start: string }>();

  return <PopViewer channelId={channelId} startId={start} />;
}
