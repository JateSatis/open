import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { FeedScreen } from './index';

import {
  searchChannels,
  searchPops,
  SEARCH_POPS_PAGE_SIZE,
  type SearchChannel,
  type SearchPop,
} from '@/api/search';
import { useSession } from '@/features/auth/useSession';
import {
  reportDeviceNetwork,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { logSearchResultOpened } from '@/features/recs/journal/searchJournal';
import { useLastSearchPop } from '@/features/search/lastSearchPop';
import {
  addRecentSearch,
  feedRecentQueries,
  loadRecentSearches,
  resetRecentSearches,
} from '@/features/search/recentSearches';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockSetOptions = jest.fn();

jest.mock('@/navigation', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => effect(), [effect]);
  },
}));

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/recs/journal/searchJournal', () => ({
  logSearchQuery: jest.fn(),
  logSearchResultOpened: jest.fn(),
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/search', () => ({
  ...jest.requireActual('@/api/search'),
  searchChannels: jest.fn(),
  searchPops: jest.fn(),
}));

const mockedChannels = jest.mocked(searchChannels);
const mockedPops = jest.mocked(searchPops);

function channel(overrides: Partial<SearchChannel> = {}): SearchChannel {
  return {
    id: 'ch-1',
    postsChatId: 'posts-1',
    title: 'Ёлки-палки',
    username: 'elki',
    avatarUrl: null,
    subscribersCount: 3,
    subscribed: false,
    mine: false,
    ...overrides,
  };
}

function pop(id: string, overrides: Partial<SearchPop> = {}): SearchPop {
  return {
    id,
    channelId: 'ch-1',
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
    viewsCount: 7,
    commentsCount: 0,
    channelTitle: 'Ёлки-палки',
    channelAvatarUrl: null,
    rank: 7,
    score: 0.5,
    scoredAt: '2026-10-13T10:00:00Z',
    ...overrides,
  };
}

async function openSearch() {
  await renderWithQuery(<FeedScreen />);
  await fireEvent.press(screen.getByTestId('feed-search-open'));
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByTestId('feed-search-input'), text);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRecentSearches();
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'me' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedChannels.mockResolvedValue([]);
  mockedPops.mockResolvedValue([]);
  resetConnectionState();
  reportRealtimeJoined();
});

it('shows the search bar on top; opening and closing the search brings no header back', async () => {
  await renderWithQuery(<FeedScreen />);

  expect(screen.getByTestId('feed-search-open')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('feed-search-open'));
  await fireEvent.press(screen.getByTestId('feed-search-cancel'));

  expect(screen.getByTestId('feed-search-open')).toBeTruthy();
  expect(mockSetOptions).not.toHaveBeenCalledWith({ headerShown: true });
});

it('shows channels and pops, asking the server for the last query only', async () => {
  mockedChannels.mockImplementation(async (query) => (query === 'елк' ? [channel()] : []));
  mockedPops.mockImplementation(async (query) => (query === 'елк' ? [pop('a'), pop('b')] : []));
  await openSearch();

  await type('е');
  await type('ел');
  await type('елк');

  expect(await screen.findByText('Каналы')).toBeTruthy();
  expect(screen.getByText('Попсы')).toBeTruthy();
  expect(screen.getByText('@elki.ch · 3 подписчика')).toBeTruthy();
  expect(screen.getAllByTestId('search-pop')).toHaveLength(2);
  expect(mockedChannels.mock.calls.map(([query]) => query)).toEqual(['елк']);
  expect(mockedPops.mock.calls.map(([query]) => query)).toEqual(['елк']);
});

it('marks my subscription and my own channel in the row', async () => {
  mockedChannels.mockResolvedValue([
    channel({ id: 'a', title: 'Подписан', username: 'a', subscribed: true }),
    channel({ id: 'b', title: 'Мой', username: 'b', mine: true }),
  ]);
  await openSearch();
  await type('канал');

  expect(await screen.findByText(/3 подписчика · вы подписаны/)).toBeTruthy();
  expect(screen.getByText(/3 подписчика · ваш канал/)).toBeTruthy();
});

it('collapses many channels to three, expands, collapses and resets on a new letter', async () => {
  mockedChannels.mockResolvedValue(
    ['a', 'b', 'c', 'd'].map((id) => channel({ id, title: `Новости ${id}`, username: id })),
  );
  await openSearch();
  await type('новости');

  expect(await screen.findAllByTestId('feed-search-channel')).toHaveLength(3);

  await fireEvent.press(screen.getByRole('button', { name: 'Показать ещё' }));
  expect(screen.getAllByTestId('feed-search-channel')).toHaveLength(4);

  await fireEvent.press(screen.getByRole('button', { name: 'Свернуть' }));
  expect(screen.getAllByTestId('feed-search-channel')).toHaveLength(3);

  await fireEvent.press(screen.getByRole('button', { name: 'Показать ещё' }));
  await type('новости ');
  await type('новости д');

  await waitFor(() => expect(screen.getAllByTestId('feed-search-channel')).toHaveLength(3));
});

it('without channels shows only pops, without pops only channels', async () => {
  mockedPops.mockResolvedValue([pop('a')]);
  await openSearch();
  await type('елка');

  expect(await screen.findByText('Попсы')).toBeTruthy();
  expect(screen.queryByText('Каналы')).toBeNull();

  mockedPops.mockResolvedValue([]);
  mockedChannels.mockResolvedValue([channel()]);
  await type('елки');

  expect(await screen.findByText('Каналы')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Попсы')).toBeNull());
});

it('says «Ничего не нашлось» when there is neither', async () => {
  await openSearch();
  await type('zzz');

  expect(await screen.findByText('Ничего не нашлось')).toBeTruthy();
});

it('a tile shows the title with the match highlighted, an old pop — its caption, and the channel', async () => {
  mockedPops.mockResolvedValue([
    pop('a', { title: 'Ёлка во дворе' }),
    pop('b', { title: null, caption: 'Старая ёлка\nв лесу' }),
  ]);
  await openSearch();
  await type('елка');

  const titles = await screen.findAllByTestId('search-pop-title');

  expect(titles[0]).toHaveTextContent('Ёлка во дворе');
  expect(titles[1]).toHaveTextContent('Старая ёлка в лесу');
  expect(screen.getAllByTestId('search-highlight').map((part) => part.props.children)).toEqual([
    'Ёлка',
    'ёлка',
  ]);
  expect(screen.getAllByText('Ёлки-палки')).toHaveLength(2);
  expect(screen.getAllByLabelText('Просмотры: 7')).toHaveLength(2);
});

it('opens a pop in the search viewer and a channel above the tabs, remembering the query', async () => {
  mockedChannels.mockResolvedValue([channel()]);
  mockedPops.mockResolvedValue([pop('a'), pop('b'), pop('c')]);
  await openSearch();
  await type('елка');

  const tiles = await screen.findAllByTestId('search-pop');
  await fireEvent.press(tiles[2]);

  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenLastCalledWith({
    name: 'PopViewer',
    params: { source: 'search', query: 'елка', startId: 'c' },
  });
  expect(useLastSearchPop.getState().id).toBe('c');
  expect(feedRecentQueries.useStore.getState().items).toEqual(['елка']);
  expect(jest.mocked(logSearchResultOpened).mock.calls).toEqual([
    ['feed', { type: 'pop', id: 'c' }, { kind: 'pop', section: 'pops', position: 2, query: 'елка' }],
  ]);

  await fireEvent.press(screen.getByTestId('feed-search-channel'));

  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenLastCalledWith({
    name: 'Channel',
    params: { channelId: 'ch-1' },
  });
  expect(feedRecentQueries.useStore.getState().items).toEqual(['елка']);
});

it('opens the visible results even when the input already contains a new query', async () => {
  mockedPops.mockResolvedValueOnce([pop('a'), pop('b')]).mockReturnValue(new Promise(() => {}));
  await openSearch();
  await type('елка');
  await screen.findAllByTestId('search-pop');

  await type('елка зимой');
  await fireEvent.press(screen.getAllByTestId('search-pop')[1]);

  expect(mockPush.mock.calls).toEqual([
    [{ name: 'PopViewer', params: { source: 'search', query: 'елка', startId: 'b' } }],
  ]);
});

it('remembers the query on «Поиск» of the keyboard', async () => {
  await openSearch();
  await type(' ёлка ');
  await fireEvent(screen.getByTestId('feed-search-input'), 'submitEditing');

  expect(feedRecentQueries.useStore.getState().items).toEqual(['ёлка']);
});

it('shows recent feed queries — not the chats ones — repeats one on tap and clears them', async () => {
  loadRecentSearches('me');
  feedRecentQueries.load('me');
  addRecentSearch({
    type: 'entity',
    entity: {
      section: 'global',
      kind: 'channel',
      id: 'x',
      chatId: 'px',
      channelId: 'x',
      personId: null,
      title: 'Из чатов',
      username: 'x',
      avatarUrl: null,
      subscribed: false,
      subscribersCount: 0,
    },
  });
  feedRecentQueries.add('кот');
  mockedPops.mockResolvedValue([pop('a')]);
  await openSearch();

  expect(await screen.findByText('Недавние')).toBeTruthy();
  expect(screen.queryByText('Из чатов')).toBeNull();

  await fireEvent.press(screen.getByTestId('feed-search-recent'));

  expect(screen.getByTestId('feed-search-input').props.value).toBe('кот');
  await waitFor(() => expect(mockedPops).toHaveBeenCalledWith('кот', null, expect.anything()));

  await type('');
  await fireEvent.press(screen.getByRole('button', { name: 'Очистить' }));

  expect(screen.queryByText('кот')).toBeNull();
  expect(feedRecentQueries.useStore.getState().items).toEqual([]);
});

it('loads the next page of pops at the end, passing the cursor with the first page’s moment', async () => {
  const first = Array.from({ length: SEARCH_POPS_PAGE_SIZE }, (_, i) =>
    pop(`p${i}`, { score: 1 - i / 100 }),
  );
  mockedPops.mockImplementation(async (_query, cursor) => (cursor ? [pop('next')] : first));
  await openSearch();
  await type('елка');

  await screen.findAllByTestId('search-pop');
  await act(async () => {
    fireEvent(screen.getByTestId('feed-search-results'), 'onEndReached');
  });

  await waitFor(() =>
    expect(mockedPops).toHaveBeenCalledWith(
      'елка',
      { rank: 7, score: 0.71, id: 'p29', scoredAt: '2026-10-13T10:00:00Z' },
      expect.anything(),
    ),
  );
});

it('offline says so and keeps the results already shown', async () => {
  mockedPops.mockResolvedValue([pop('a')]);
  await openSearch();
  await type('елка');
  await screen.findAllByTestId('search-pop');

  await act(async () => reportDeviceNetwork(false));

  expect(await screen.findByText('Нет связи — поиск недоступен.')).toBeTruthy();
  expect(screen.getAllByTestId('search-pop')).toHaveLength(1);
  expect(screen.queryByLabelText('Ищем')).toBeNull();
});

it('when the next page fails, keeps what is shown, explains and stops spinning', async () => {
  const first = Array.from({ length: SEARCH_POPS_PAGE_SIZE }, (_, i) => pop(`p${i}`));
  mockedPops.mockImplementation(async (_query, cursor) => {
    if (cursor) throw new Error('boom');
    return first;
  });
  await openSearch();
  await type('елка');
  await screen.findAllByTestId('search-pop');

  await act(async () => {
    fireEvent(screen.getByTestId('feed-search-results'), 'onEndReached');
  });

  expect(await screen.findByText('Не удалось загрузить ещё. Пролистайте ещё раз.')).toBeTruthy();
  expect(screen.queryByLabelText('Ищем')).toBeNull();
  expect(screen.getAllByTestId('search-pop').length).toBeGreaterThan(0);
});
