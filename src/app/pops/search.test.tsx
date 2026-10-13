import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import SearchPopViewerRoute from './search';

import { canPublishInChannel, recordPopViews } from '@/api/pops';
import { acquirePopTopic } from '@/api/popTopics';
import { searchPops, SEARCH_POPS_PAGE_SIZE, type SearchPop } from '@/api/search';
import { getMySubscription, subscribeToChannel } from '@/api/subscriptions';
import { useLastSearchPop } from '@/features/search/lastSearchPop';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: { q: string; start: string } = { q: 'елка', start: 'b' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: 'pops/search' }] }),
  }),
}));
jest.mock('expo-video', () => {
  const { View } = require('react-native');

  return {
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({ remove: jest.fn() }),
    }),
    VideoView: (props: object) => <View {...props} />,
  };
});
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/search', () => ({
  ...jest.requireActual('@/api/search'),
  searchPops: jest.fn(),
}));
jest.mock('@/api/pops', () => ({
  listPopCounters: jest.fn(() => Promise.resolve([])),
  recordPopViews: jest.fn(() => Promise.resolve()),
  canPublishInChannel: jest.fn(),
}));
jest.mock('@/api/subscriptions', () => ({
  getMySubscription: jest.fn(),
  subscribeToChannel: jest.fn(),
  setChannelInChats: jest.fn(),
}));
jest.mock('@/api/reactions', () => ({ setPopReaction: jest.fn() }));
jest.mock('@/api/comments', () => ({ setCommentReaction: jest.fn() }));
jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => 'me' }));
jest.mock('@/features/interactions/CommentsPanel', () => ({ CommentsPanel: () => null }));
jest.mock('@/api/popTopics', () => ({ acquirePopTopic: jest.fn(() => () => undefined) }));
// Канал не загружен — шапка берёт имя из строки выдачи.
jest.mock('@/api/channels', () => ({ getChannel: jest.fn(() => new Promise(() => {})) }));

function pop(id: string, channelId: string, overrides: Partial<SearchPop> = {}): SearchPop {
  return {
    id,
    channelId,
    authorId: 'author',
    title: `Ёлка ${id}`,
    caption: null,
    url: `https://cdn/${id}.mp4`,
    posterUrl: `https://cdn/${id}.jpg`,
    mimeType: 'video/mp4',
    width: 720,
    height: 1280,
    durationMs: 6000,
    createdAt: '2026-10-12T10:00:00Z',
    reactions: { counts: {}, mine: null },
    viewsCount: 0,
    commentsCount: 0,
    channelTitle: `Канал ${channelId}`,
    channelAvatarUrl: null,
    rank: 7,
    score: 0.5,
    scoredAt: '2026-10-13T10:00:00Z',
    ...overrides,
  };
}

async function open(pops: SearchPop[], start: string) {
  mockParams = { q: 'елка', start };
  jest.mocked(searchPops).mockImplementation(async (_query, cursor) => (cursor ? [] : pops));

  await renderWithQuery(<SearchPopViewerRoute />);
  await fireEvent(screen.getByTestId('pop-viewer'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 800 } },
  });
  await screen.findByTestId('pop-page-active');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(canPublishInChannel).mockImplementation(async (channelId) => channelId === 'mine');
  jest.mocked(getMySubscription).mockResolvedValue(null);
  jest.mocked(subscribeToChannel).mockResolvedValue();
});

const mixed = [pop('a', 'A'), pop('b', 'B'), pop('c', 'A')];

it('starts at the tapped pop with its own channel in the header', async () => {
  await open(mixed, 'b');

  const page = within(screen.getByTestId('pop-page-active'));

  expect(await page.findByText('Канал B')).toBeTruthy();
  expect(page.getByTestId('pop-title')).toHaveTextContent('Ёлка b');
  expect(useLastSearchPop.getState().id).toBe('b');
});

it('«Подписаться» subscribes to the channel of this pop', async () => {
  await open(mixed, 'b');

  const page = within(screen.getByTestId('pop-page-active'));

  fireEvent.press(await page.findByRole('button', { name: 'Подписаться' }));

  await waitFor(() => expect(subscribeToChannel).toHaveBeenCalledWith('B', false));
});

it('the channel name opens that channel above the viewer', async () => {
  await open(mixed, 'b');

  fireEvent.press(within(screen.getByTestId('pop-page-active')).getByTestId('pop-channel-name'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/channel/[channelId]',
    params: { channelId: 'B' },
  });
  expect(mockBack).not.toHaveBeenCalled();
});

it('listens to the counters of the channels of the active and neighbour pages', async () => {
  await open([...mixed, pop('d', 'C')], 'b');

  const channels = jest.mocked(acquirePopTopic).mock.calls.map(([channelId]) => channelId);

  expect(new Set(channels)).toEqual(new Set(['A', 'B']));
});

it('counts a view of a stranger’s pop', async () => {
  jest.useFakeTimers();
  await open(mixed, 'b');
  await act(() => jest.advanceTimersByTime(2500));
  expect(recordPopViews).toHaveBeenCalledWith(['b'], expect.any(String));
  jest.useRealTimers();
});

it('does not count a view of a pop of my own channel', async () => {
  jest.useFakeTimers();
  await open([pop('m', 'mine')], 'm');
  await act(() => jest.advanceTimersByTime(2500));
  expect(recordPopViews).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('loads the next page of results when the active pop nears the end', async () => {
  const page = Array.from({ length: SEARCH_POPS_PAGE_SIZE }, (_, i) =>
    pop(`p${i}`, i % 2 ? 'A' : 'B', { score: 1 - i / 100 }),
  );

  await open(page, 'p28');

  await waitFor(() =>
    expect(searchPops).toHaveBeenCalledWith(
      'елка',
      { rank: 7, score: 0.71, id: 'p29', scoredAt: '2026-10-13T10:00:00Z' },
      expect.anything(),
    ),
  );
});
