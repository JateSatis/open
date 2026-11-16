import { router } from 'expo-router';

import type { PopViewerScreenParams } from './PopViewerScreen';

import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

export function openPopViewer(params: PopViewerScreenParams) {
  if (params.source === 'search') {
    router.push({ pathname: '/pops/search', params: { q: params.query, start: params.startId } });
    return;
  }

  closeComments();
  router.push({
    pathname: '/pops/[channelId]',
    params: {
      channelId: params.channelId,
      start: params.startId,
      from: params.entry ?? 'channel_grid',
    },
  });
}
