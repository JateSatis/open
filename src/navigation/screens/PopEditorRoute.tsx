import { useRouteParams } from '@/navigation';

import { PopEditor } from '@/features/pops/PopEditor';

export function PopEditorRoute() {
  const { channelId, from } = useRouteParams<'PopEditor'>();

  return <PopEditor channelId={channelId} from={from === 'posts' ? 'posts' : 'pops'} />;
}
