import { renderHook } from '@testing-library/react-native';

import { useOpenChannel } from './useOpenChannel';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockState: object = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useNavigation: () => ({ getState: () => mockState, dispatch: mockDispatch }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

/** Корневой стек: вкладки, в них стек чатов с экраном канала, сверху просмотр. */
function viewerAbove(channelId: string) {
  return {
    key: 'root',
    index: 1,
    routes: [
      {
        key: 'tabs',
        name: '(tabs)',
        state: {
          key: 'tabs-nav',
          index: 0,
          routes: [
            {
              key: 'chats-tab',
              name: 'chats',
              state: {
                key: 'chats-stack',
                index: 1,
                routes: [
                  { key: 'list', name: 'index' },
                  { key: 'channel-screen', name: 'channel/[channelId]', params: { channelId } },
                ],
              },
            },
          ],
        },
      },
      { key: 'viewer', name: 'pops/[channelId]' },
    ],
  };
}

async function press(channelId: string, mode: 'under' | 'over') {
  const { result } = await renderHook(() => useOpenChannel(channelId, mode));

  result.current();
}

describe('useOpenChannel', () => {
  it('opens the channel under the viewer on «Попсы»', async () => {
    mockState = {
      key: 'root',
      index: 1,
      routes: [
        { key: 'tabs', name: '(tabs)' },
        { key: 'v', name: 'pops' },
      ],
    };

    await press('A', 'under');

    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'A', section: 'pops' },
    });
  });

  it('opens the channel above the search viewer on «Попсы»', async () => {
    mockState = {
      key: 'root',
      index: 1,
      routes: [
        { key: 'tabs', name: '(tabs)' },
        { key: 'v', name: 'pops/search' },
      ],
    };

    await press('B', 'over');

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/channel/[channelId]',
      params: { channelId: 'B', section: 'pops' },
    });
  });

  it('goes back to the channel already under the viewer and asks it for «Попсы»', async () => {
    mockState = viewerAbove('A');

    await press('A', 'under');

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
    // Экран — во вложенном стеке чатов: действие адресовано тому стеку.
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_PARAMS',
        source: 'channel-screen',
        target: 'chats-stack',
        payload: {
          params: expect.objectContaining({
            section: 'pops',
            sectionKey: expect.any(String),
            jumpTo: undefined,
          }),
        },
      }),
    );
  });

  it('opens a new screen when the channel under the viewer is another one', async () => {
    mockState = viewerAbove('other');

    await press('A', 'under');

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'A', section: 'pops' },
    });
  });
});
