import { router } from '@/navigation';

import type { PopViewerScreenParams } from './PopViewerScreen';

import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

export function openPopViewer(params: PopViewerScreenParams) {
  if (params.source === 'channel') closeComments();
  router.push({
    name: 'PopViewer',
    params:
      params.source === 'channel' ? { ...params, entry: params.entry ?? 'channel_grid' } : params,
  });
}
