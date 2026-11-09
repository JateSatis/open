import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

/** Открыть выбранный поп из сетки канала. */
export function openPopViewer(channelId: string, popId: string) {
  closeComments();
  void import('expo-router').then(({ router }) =>
    router.push({
      pathname: '/pops/[channelId]',
      params: { channelId, start: popId, from: 'channel_grid' },
    }),
  );
}
