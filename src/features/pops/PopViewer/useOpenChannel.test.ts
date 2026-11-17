import { renderHook } from '@testing-library/react-native';

import { useOpenChannel } from './useOpenChannel';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockState: object = {};

jest.mock('@/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: mockPush }),
  useNavigation: () => ({ getState: () => mockState, dispatch: mockDispatch }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

/** Корневой стек: вкладки, в них стек чатов с экраном канала, сверху просмотр. */
function viewerAbove(channelId: string) {
  return { index: 2, routes: [
    {name: 'Tabs'}, {name: 'Channel', key: 'channel-screen', params: {channelId}}, {name: 'PopViewer'},
  ]};
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

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({
      name: 'Channel',
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
      name: 'Channel',
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
        payload: {
          params: expect.objectContaining({
            section: 'pops',
            sectionKey: expect.any(String),
          }),
        },
      }),
    );
  });

  it('opens a new screen when the channel under the viewer is another one', async () => {
    mockState = viewerAbove('other');

    await press('A', 'under');

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({
      name: 'Channel',
      params: { channelId: 'A', section: 'pops' },
    });
  });
});
