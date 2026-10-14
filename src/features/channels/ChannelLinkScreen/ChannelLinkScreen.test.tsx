import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChannelLinkScreen } from '.';

import { findChannelByUsername } from '@/api/channels';
import { useSession } from '@/features/auth/useSession';
import { getPendingLink, setPendingLink } from '@/store/pendingLink';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/channels', () => ({ findChannelByUsername: jest.fn() }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
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

jest.mock('expo-router', () => ({
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

const channelHref = { pathname: '/chats/channel/[channelId]', params: { channelId: 'channel-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  setPendingLink(null);
  jest.mocked(useSession).mockReturnValue({ isAuthenticated: true, isLoading: false } as ReturnType<
    typeof useSession
  >);
});

describe('ChannelLinkScreen', () => {
  it('opens the channel in the chats tab over what was open, so «back» returns there', async () => {
    jest.mocked(findChannelByUsername).mockResolvedValue('channel-1');

    await renderWithQuery(<ChannelLinkScreen username="News" />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(channelHref));
    expect(findChannelByUsername).toHaveBeenCalledWith('News');
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('on a cold start replaces itself with the channel', async () => {
    mockCanGoBack = false;
    jest.mocked(findChannelByUsername).mockResolvedValue('channel-1');

    await renderWithQuery(<ChannelLinkScreen username="news" />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(channelHref));
  });

  it('says «Канал не найден» and goes back', async () => {
    jest.mocked(findChannelByUsername).mockResolvedValue(null);

    await renderWithQuery(<ChannelLinkScreen username="nosuchname" />);

    expect(await screen.findByText('Канал не найден')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('channel-link-back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('without a session remembers the link and asks to sign in', async () => {
    jest.mocked(useSession).mockReturnValue({ isAuthenticated: false, isLoading: false } as ReturnType<
      typeof useSession
    >);

    await renderWithQuery(<ChannelLinkScreen username="news" />);

    expect(mockRedirect).toHaveBeenCalledWith('/(auth)/sign-in');
    expect(getPendingLink()).toBe('/c/news');
    expect(findChannelByUsername).not.toHaveBeenCalled();
  });
});
