import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import ChatsScreen from './index';

import type { ChatSummary } from '@/api/chats';
import { listChats } from '@/api/chats';
import { listInvites } from '@/api/invites';
import {
  recheckRecentSearches,
  searchEntities,
  searchMessages,
  type SearchEntity,
  type SearchMessage,
} from '@/api/search';
import { useSession } from '@/features/auth/useSession';
import {
  reportDeviceNetwork,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { resetRecentSearches } from '@/features/search/recentSearches';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockSetOptions = jest.fn();
/** Эффекты фокуса смонтированных хуков — «вернуться на экран» зовёт их снова. */
const mockFocusEffects = new Set<() => void | (() => void)>();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  // Экран в фокусе: эффект фокуса — обычный эффект; все живые запоминаются.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      mockFocusEffects.add(effect);
      const cleanup = effect();
      return () => {
        mockFocusEffects.delete(effect);
        cleanup?.();
      };
    }, [effect]);
  },
}));

jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/chats', () => ({ listChats: jest.fn() }));
jest.mock('@/api/chatInfo', () => ({ getLastSeen: jest.fn(() => Promise.resolve(new Map())) }));
jest.mock('@/api/invites', () => ({ listInvites: jest.fn() }));
jest.mock('@/api/saved', () => ({
  getSavedSummary: jest.fn(() => Promise.resolve({ watchLaterPending: 0 })),
}));
jest.mock('@/api/search', () => ({
  searchEntities: jest.fn(),
  searchMessages: jest.fn(),
  recheckRecentSearches: jest.fn(),
}));

const mockedEntities = jest.mocked(searchEntities);
const mockedMessages = jest.mocked(searchMessages);
const mockedRecheck = jest.mocked(recheckRecentSearches);

const READ_AT = '2026-10-13T09:00:00Z';

const dialog: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: null,
  username: null,
  channel: null,
  participants: [
    { id: 'me', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT },
    { id: 'anna', displayName: 'Анна Ёлкина', avatarUrl: null, lastReadAt: READ_AT },
  ],
  waiting: [],
  lastMessagePreview: 'до встречи',
  lastMessageAt: READ_AT,
  lastMessageAuthorId: 'anna',
  lastPopAt: null,
  lastActivityAt: READ_AT,
  listPosition: null,
  enteredAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 0,
};

function entity(overrides: Partial<SearchEntity>): SearchEntity {
  return {
    section: 'global',
    kind: 'channel',
    id: 'ch-1',
    chatId: 'posts-1',
    channelId: 'ch-1',
    personId: null,
    title: 'Ёлки-палки',
    username: 'elki',
    avatarUrl: null,
    subscribed: false,
    subscribersCount: 3,
    ...overrides,
  };
}

const post: SearchMessage = {
  id: 'msg-1',
  chatId: 'posts-1',
  chatKind: 'channel',
  channelId: 'ch-1',
  chatTitle: 'Ёлки-палки',
  chatAvatarUrl: null,
  authorId: 'anna',
  authorName: 'Анна',
  text: 'Ёлка уже стоит',
  seq: 1,
  createdAt: '2026-10-12T10:00:00Z',
  fuzzy: false,
};

async function openSearch() {
  await renderWithQuery(<ChatsScreen />);
  await screen.findByText('Анна Ёлкина');
  await fireEvent.press(screen.getByTestId('chats-search-open'));
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByTestId('chats-search-input'), text);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusEffects.clear();
  resetRecentSearches();
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'me' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  jest.mocked(listChats).mockResolvedValue([dialog]);
  jest.mocked(listInvites).mockResolvedValue([]);
  mockedEntities.mockResolvedValue([]);
  mockedMessages.mockResolvedValue({ items: [], nextCursor: null });
  // Сервер подтверждает всё сохранённое; что он скрыл — свой тест.
  // Сервер подтверждает всех — такими, какими их нашли: Ёлкин имени не скрывал.
  mockedRecheck.mockImplementation(async (people, messages) => ({
    people: new Map(
      people.map((id) => [id, { title: 'Ёлкин', username: 'elkin', avatarUrl: null }]),
    ),
    messages: new Map(
      messages.map((id) => [
        id,
        { createdAt: '2026-10-12T10:00:00Z', authorName: 'Анна', chatTitle: null },
      ]),
    ),
    chats: new Map(),
  }));
  resetConnectionState();
  reportRealtimeJoined();
});

it('hides the chat list while searching and brings it back on «Отмена», never touching a header', async () => {
  await openSearch();

  expect(screen.queryByText('до встречи')).toBeNull();

  await type('анна');
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));

  expect(await screen.findByText('до встречи')).toBeTruthy();
  expect(screen.queryByTestId('chats-search-input')).toBeNull();
  expect(screen.getByTestId('chats-search-open')).toBeTruthy();
  // Шапки у «Чатов» нет: поиск её не прячет и, закрываясь, не возвращает.
  expect(mockSetOptions).not.toHaveBeenCalledWith({ headerShown: true });
});

it('leaves the search on the system «back» instead of the app', async () => {
  const listeners: (() => boolean)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener as () => boolean);
    return { remove: jest.fn() };
  });

  await openSearch();
  expect(mockFocusEffects.size).toBeGreaterThan(0);

  let handled = false;
  await act(async () => {
    handled = listeners[listeners.length - 1]();
  });

  expect(handled).toBe(true);
  expect(await screen.findByText('до встречи')).toBeTruthy();
});

it('finds my own chat at once from the cache, before the server answers', async () => {
  mockedEntities.mockReturnValue(new Promise(() => {}));
  await openSearch();

  await type('елкина');

  // Заголовок блока выдачи, а не подпись вкладки.
  expect(
    await within(await screen.findByTestId('chats-search-results')).findByText('Чаты'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Анна Ёлкина' })).toBeTruthy();
});

it('shows the server blocks in order and asks for the last query only', async () => {
  mockedEntities.mockImplementation(async (query) =>
    query === 'елк'
      ? [
          entity({}),
          entity({
            section: 'global',
            kind: 'person',
            id: 'p1',
            title: 'Ёлкин',
            username: 'elkin',
          }),
        ]
      : [],
  );
  mockedMessages.mockResolvedValue({ items: [post], nextCursor: null });
  await openSearch();

  await type('е');
  await type('ел');
  await type('елк');

  expect(await screen.findByText('Глобальный поиск')).toBeTruthy();
  expect(screen.getByText('Сообщения')).toBeTruthy();
  expect(screen.getByText('@elki.ch')).toBeTruthy();
  expect(screen.getByText('@elkin')).toBeTruthy();
  // Набор быстрее паузы — на сервер уходит только итог.
  expect(mockedEntities.mock.calls.map(([query]) => query)).toEqual(['елк']);
});

it('collapses a long block to three rows, expands and collapses it, and resets on a new letter', async () => {
  const many = ['a', 'b', 'c', 'd'].map((id) =>
    entity({ id, channelId: id, chatId: `posts-${id}`, title: `Новости ${id}`, username: id }),
  );
  mockedEntities.mockResolvedValue(many);
  await openSearch();

  await type('новости');
  await screen.findByText('Новости a');
  expect(screen.queryByText('Новости d')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Показать ещё' }));
  expect(screen.getByText('Новости d')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Свернуть' }));
  expect(screen.queryByText('Новости d')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Показать ещё' }));
  await type('новост');
  await waitFor(() => expect(screen.queryByText('Новости d')).toBeNull());
});

it('opens and remembers channels and people but leaves message results inactive', async () => {
  mockedEntities.mockResolvedValue([
    entity({}),
    entity({
      kind: 'person',
      id: 'p1',
      channelId: null,
      chatId: null,
      title: 'Ёлкин',
      username: 'elkin',
    }),
  ]);
  mockedMessages.mockResolvedValue({ items: [post], nextCursor: null });
  await openSearch();
  await type('елк');

  await fireEvent.press(await screen.findByRole('button', { name: 'Ёлки-палки' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/chats/channel/[channelId]',
    params: { channelId: 'ch-1' },
  });

  await fireEvent.press(screen.getByRole('button', { name: 'Ёлкин' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/chats/people/[userId]',
    params: { userId: 'p1' },
  });

  expect(screen.getByTestId('search-message')).toBeDisabled();
  mockPush.mockClear();
  await fireEvent.press(screen.getByTestId('search-message'));
  expect(mockPush).not.toHaveBeenCalled();

  await type('');
  expect(await screen.findByText('Недавние')).toBeTruthy();
  // Люди и сообщения «Недавних» показываются после перепроверки сервером.
  expect(await screen.findByRole('button', { name: 'Ёлкин' })).toBeTruthy();
  const rows = screen.getAllByRole('button').map((button) => button.props.accessibilityLabel);
  expect(rows).not.toContain(`Ёлки-палки: ${post.text}`);

  await fireEvent.press(screen.getByRole('button', { name: 'Очистить' }));
  expect(screen.queryByText('Недавние')).toBeNull();
});

it('К3.4 forgets a person in «Недавние» once the server no longer lets me find them', async () => {
  mockedEntities.mockResolvedValue([
    entity({
      section: 'global',
      kind: 'person',
      id: 'p1',
      personId: 'p1',
      title: 'Ёлкин',
      chatId: null,
      channelId: null,
    }),
  ]);
  await openSearch();
  await type('елк');
  // Человек закрыл от меня поиск после того, как я его нашёл: сохранённую
  // строку сервер больше не подтверждает.
  mockedRecheck.mockResolvedValue({ people: new Map(), messages: new Map(), chats: new Map() });
  await fireEvent.press(await screen.findByRole('button', { name: 'Ёлкин' }));
  await type('');

  await waitFor(() => expect(mockedRecheck).toHaveBeenCalledWith(['p1'], [], []));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Ёлкин' })).toBeNull());
});

it('shows a person in «Недавние» as I see them now: hidden name — alias, without @username', async () => {
  mockedEntities.mockResolvedValue([
    entity({
      section: 'global',
      kind: 'person',
      id: 'p1',
      personId: 'p1',
      title: 'Ёлкин',
      username: 'elkin',
      chatId: null,
      channelId: null,
    }),
  ]);
  await openSearch();
  await type('елк');
  // Нашёл по имени, а человек потом скрыл его от меня: в «Недавних» — псевдоним.
  mockedRecheck.mockResolvedValue({
    people: new Map([['p1', { title: 'Илья Муромцев', username: null, avatarUrl: null }]]),
    messages: new Map(),
    chats: new Map(),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Ёлкин' }));
  await type('');

  expect(await screen.findByRole('button', { name: 'Илья Муромцев' })).toBeTruthy();
  expect(screen.queryByText('Ёлкин')).toBeNull();
  expect(screen.queryByText(/elkin/)).toBeNull();
});

it('does not navigate to a message of a group chat', async () => {
  const message: SearchMessage = { ...post, chatId: 'group-1', chatKind: 'group', channelId: null };
  mockedMessages.mockResolvedValue({ items: [message], nextCursor: null });
  await openSearch();
  await type('елк');

  await fireEvent.press(await screen.findByTestId('search-message'));
  expect(screen.getByTestId('search-message')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('search-message'));
  expect(mockPush).not.toHaveBeenCalled();
});

it('without a network says so and still shows my own chats', async () => {
  await openSearch();
  await act(async () => reportDeviceNetwork(false));

  await type('анна');

  expect(await screen.findByText('Нет связи — ищем только по вашим чатам.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Анна Ёлкина' })).toBeTruthy();
});

it('loads the next page of messages when scrolled to the end', async () => {
  mockedMessages.mockImplementation(async (_query, cursor) =>
    cursor
      ? { items: [{ ...post, id: 'msg-2', text: 'Ёлка вторая' }], nextCursor: null }
      : { items: [post], nextCursor: post.seq },
  );
  await openSearch();
  await type('елк');
  await screen.findByText('Сообщения');

  await fireEvent(screen.getByTestId('chats-search-results'), 'onEndReached');

  await waitFor(() =>
    expect(mockedMessages).toHaveBeenLastCalledWith(
      'елк',
      post.seq,
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.getAllByTestId('search-message')).toHaveLength(2));
});

it('does not say «Ничего не нашлось» while messages are still on their way', async () => {
  mockedMessages.mockReturnValue(new Promise(() => {}));
  await openSearch();

  await type('zzz');

  await waitFor(() => expect(mockedEntities).toHaveBeenCalledWith('zzz', expect.anything()));
  expect(screen.queryByText('Ничего не нашлось')).toBeNull();
  expect(screen.getByLabelText('Ищем')).toBeTruthy();
});

it('does not show the answer to an old query after the field was cleared', async () => {
  mockedEntities.mockImplementation((query) =>
    query === 'елк' ? Promise.resolve([entity({})]) : new Promise(() => {}),
  );
  await openSearch();
  await type('елк');
  expect(await screen.findByText('@elki.ch')).toBeTruthy();

  await type('');
  await type('новое');

  await waitFor(() => expect(mockedEntities).toHaveBeenCalledWith('новое', expect.anything()));
  expect(screen.queryByText('@elki.ch')).toBeNull();
});

it('keeps the previous answer while the same query is typed further', async () => {
  mockedEntities.mockImplementation((query) =>
    query === 'елк' ? Promise.resolve([entity({})]) : new Promise(() => {}),
  );
  await openSearch();
  await type('елк');
  expect(await screen.findByText('@elki.ch')).toBeTruthy();

  await type('елки');

  await waitFor(() => expect(mockedEntities).toHaveBeenCalledWith('елки', expect.anything()));
  expect(screen.getByText('@elki.ch')).toBeTruthy();
});

it('still shows my own chats offline when the query was already answered before', async () => {
  mockedEntities.mockResolvedValue([
    entity({
      section: 'mine',
      kind: 'direct',
      id: 'chat-1',
      chatId: 'chat-1',
      channelId: null,
      title: 'Анна Ёлкина',
      username: null,
    }),
  ]);
  await openSearch();
  await type('анна');
  await within(await screen.findByTestId('chats-search-results')).findByText('Чаты');

  await act(async () => reportDeviceNetwork(false));

  expect(await screen.findByText('Нет связи — ищем только по вашим чатам.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Анна Ёлкина' })).toBeTruthy();
});

it('asks again when the screen is back in focus — a subscription may have moved a channel', async () => {
  mockedEntities.mockResolvedValue([entity({})]);
  await openSearch();
  await type('елк');
  await screen.findByText('Глобальный поиск');
  const calls = mockedEntities.mock.calls.length;

  await act(async () => {
    mockFocusEffects.forEach((effect) => effect());
  });

  await waitFor(() => expect(mockedEntities.mock.calls.length).toBeGreaterThan(calls));
});

it('keeps the messages already shown when the next page fails', async () => {
  mockedMessages.mockImplementation(async (_query, cursor) => {
    if (cursor) throw new Error('timeout');
    return { items: [post], nextCursor: post.seq };
  });
  mockedEntities.mockResolvedValue([entity({})]);
  await openSearch();
  await type('елк');
  await screen.findByTestId('search-message');

  await fireEvent(screen.getByTestId('chats-search-results'), 'onEndReached');

  await waitFor(() => expect(mockedMessages).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('search-message')).toBeTruthy();
  expect(screen.getByText('Глобальный поиск')).toBeTruthy();
});
