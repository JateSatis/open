import { useNavigation, useRouter } from '@/navigation';
import { useCallback } from 'react';

import { sectionRequestParams } from '@/features/channels/sectionRequest';

export type OpenChannelMode = 'under' | 'over';

export function useOpenChannel(channelId: string, mode: OpenChannelMode = 'under'): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState();
    const below = state?.routes[state.index - 1];

    if (
      mode === 'under' &&
      below?.name === 'Channel' &&
      (below.params as { channelId?: string })?.channelId === channelId
    ) {
      navigation.dispatch({
        type: 'SET_PARAMS',
        payload: { params: sectionRequestParams('pops') },
        source: below.key,
      });
      router.back();
      return;
    }

    const params = { channelId, section: 'pops' };

    if (mode === 'over') {
      router.push({ name: 'Channel', params });
      return;
    }

    router.replace({ name: 'Channel', params });
  }, [channelId, mode, navigation, router]);
}
