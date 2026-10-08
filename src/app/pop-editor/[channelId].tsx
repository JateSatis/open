import { useLocalSearchParams } from 'expo-router';

import { PopEditor } from '@/features/pops/PopEditor';

export default function PopEditorRoute() {
  const { channelId, from } = useLocalSearchParams<{ channelId: string; from?: string }>();

  return <PopEditor channelId={channelId} from={from === 'posts' ? 'posts' : 'pops'} />;
}
