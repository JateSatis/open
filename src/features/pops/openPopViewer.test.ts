import { router } from '@/navigation';

import { openPopViewer } from './openPopViewer';

import { closeComments } from '@/features/interactions/comments/commentsPanelStore';

jest.mock('@/navigation', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/interactions/comments/commentsPanelStore', () => ({ closeComments: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

it('closes comments before opening the selected pop from a channel grid', () => {
  openPopViewer({ source: 'channel', channelId: 'channel-1', startId: 'pop-2' });

  expect(closeComments).toHaveBeenCalledTimes(1);
  expect(jest.mocked(closeComments).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(router.push).mock.invocationCallOrder[0],
  );
  expect(jest.mocked(router.push).mock.calls).toEqual([
    [{ name: 'PopViewer', params: { source: 'channel', channelId: 'channel-1', startId: 'pop-2', entry: 'channel_grid' } }],
  ]);
});

it('opens the selected search pop for the supplied query', () => {
  openPopViewer({ source: 'search', query: 'два слова', startId: 'pop-3' });

  expect(closeComments).not.toHaveBeenCalled();
  expect(jest.mocked(router.push).mock.calls).toEqual([
    [{ name: 'PopViewer', params: { source: 'search', query: 'два слова', startId: 'pop-3' } }],
  ]);
});
