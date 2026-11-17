import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChannelLinkScreen } from '.';

import { findChannelByUsername } from '@/api/channels';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/channels', () => ({ findChannelByUsername: jest.fn() }));
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: () => null,
  LinearGradient: () => null,
  Rect: () => null,
  vec: (x: number, y: number) => ({ x, y }),
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRedirect = jest.fn();
let mockCanGoBack = true;

let mockPageParams: Record<string, unknown>;
jest.mock('@/navigation', () => ({
  useRouteParams: () => (mockPageParams),
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirect(href);
    return null;
  },
}));

const channelHref = { name: 'Channel', params: { channelId: 'channel-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

describe('ChannelLinkScreen', () => {
  it('opens the channel in the chats tab over what was open, so «back» returns there', async () => {
    jest.mocked(findChannelByUsername).mockResolvedValue('channel-1');

    mockPageParams = { username: 'News' };
    await renderWithQuery(<ChannelLinkScreen />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith(channelHref));
    expect(findChannelByUsername).toHaveBeenCalledWith('News');
  });

  it('on a cold start replaces itself with the channel', async () => {
    mockCanGoBack = false;
    jest.mocked(findChannelByUsername).mockResolvedValue('channel-1');

    mockPageParams = { username: 'news' };
    await renderWithQuery(<ChannelLinkScreen />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith(channelHref));
  });

  it('says «Канал не найден» and goes back', async () => {
    jest.mocked(findChannelByUsername).mockResolvedValue(null);

    mockPageParams = { username: 'nosuchname' };
    await renderWithQuery(<ChannelLinkScreen />);

    expect(await screen.findByText('Канал не найден')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('channel-link-back'));
    expect(mockBack).toHaveBeenCalled();
  });

});
