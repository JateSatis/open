import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { useState, type ReactElement } from 'react';

import { SavedScreen } from './index';

import type { ChatSummary } from '@/api/chats';
import {
  countSavedMessages,
  fetchSourceChats,
  listSavedMessages,
  listSavedPins,
  listSavedTags,
  listWatchLater,
  type SavedFilterInput,
  type SavedMessage,
} from '@/api/saved';
import { useSession } from '@/features/auth/useSession';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import {
  getSavedFilters,
  resetSavedFilters,
  useSavedFiltersStore,
} from '@/features/saved/savedFiltersStore';
import { renderWithQuery } from '@/test/renderWithQuery';

// Справа в шапке — кнопки экрана: их ставит `setOptions`, тест рисует их рядом с экраном.
let mockSetHeader: ((render: (() => ReactElement) | undefined) => void) | undefined;

function HeaderHost() {
  const [headerRight, setHeaderRight] = useState<(() => ReactElement) | undefined>();

  mockSetHeader = (next) => setHeaderRight(() => next);

  return headerRight ? headerRight() : null;
}

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({
    setOptions: (options: { headerRight?: () => ReactElement }) =>
      mockSetHeader?.(options.headerRight),
  }),
  useIsFocused: () => true,
  Stack: { Screen: () => null },
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/saved/SavedComposer', () => ({ SavedComposer: () => null }));
jest.mock('@/features/profile/queries', () => ({ useMyProfile: () => ({ data: undefined }) }));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  MediaViewer: () => null,
  VoicePlayer: () => null,
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/saved', () => ({
  listSavedMessages: jest.fn(),
  fetchSourceChats: jest.fn(),
  listSavedTags: jest.fn(),
  getSavedSource: jest.fn(),
  getSavedSummary: jest.fn(() => Promise.resolve({ watchLaterPending: 0 })),
  listSavedPins: jest.fn(() => Promise.resolve([])),
  listSavedAround: jest.fn(),
  listWatchLater: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  countSavedMessages: jest.fn(),
  createSavedTag: jest.fn(),
}));

const mockedList = listSavedMessages as jest.MockedFunction<typeof listSavedMessages>;
const mockedLater = listWatchLater as jest.MockedFunction<typeof listWatchLater>;
const mockedPins = listSavedPins as jest.MockedFunction<typeof listSavedPins>;
const mockedCount = countSavedMessages as jest.MockedFunction<typeof countSavedMessages>;

function chat(id: string): ChatSummary {
  return {
    id,
    kind: 'group',
    ownerId: null,
    description: null,
    avatarUrl: null,
    title: 'Группа',
    participants: [],
    waiting: [],
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageAuthorId: null,
    lastPopAt: null,
    lastActivityAt: null,
    listPosition: null,
    enteredAt: null,
    previewIsPop: false,
    subscription: null,
    hasUnread: false,
    subscribersCount: 0,
    username: null,
    channel: null,
  };
}

function saved(id: string, seq: number, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id,
    seq,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'visitor',
    sourceChatId: 'chat-g',
    sourceMessageId: `msg-${id}`,
    sourceCommentId: null,
    sourceSeq: 42,
    commentMessageId: null,
    commentPopId: null,
    kind: 'text',
    text: `текст ${id}`,
    authorId: 'user-anna',
    authorName: 'Анна',
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: null,
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments: [],
    tagIds: [],
    edited: false,
    replies: [],
    ...overrides,
  };
}

const work = saved('work', 2, { tagIds: ['tag-w'] });
const plain = saved('plain', 1, { text: 'про ёжика' });

/** Сервер под фильтром: теги — любой из, поиск — по подстроке. */
function serve(filter: SavedFilterInput | null) {
  return [work, plain].filter(
    (item) =>
      (!filter?.tags || item.tagIds.some((id) => filter.tags?.includes(id))) &&
      (!filter?.categories || filter.categories.includes(item.category)) &&
      (!filter?.q || (item.text ?? '').includes(filter.q)),
  );
}

function renderScreen() {
  return renderWithQuery(
    <>
      <HeaderHost />
      <SavedScreen />
    </>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSavedFilters();
  useInAppAlert.setState({ alert: null });
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  (listSavedTags as jest.Mock).mockResolvedValue([
    { id: 'tag-w', name: 'Работа', color: 0, usesCount: 1 },
  ]);
  (fetchSourceChats as jest.Mock).mockResolvedValue(new Map([['chat-g', chat('chat-g')]]));
  mockedList.mockImplementation(async (_param, _limit, filter) => ({
    items: serve(filter ?? null),
    nextCursor: null,
    prevCursor: null,
  }));
  mockedCount.mockImplementation(async (filter) => serve(filter).length);
});

describe('SavedScreen — фильтры', () => {
  it('filters by a tag from the sheet; the chip removes it, ⊗ clears all', async () => {
    const view = await renderScreen();

    expect(await view.findByText('про ёжика')).toBeTruthy();

    await fireEvent.press(await view.findByTestId('saved-filters-open'));
    expect(await view.findByTestId('saved-filter-sheet')).toBeTruthy();
    // «Файлы» — неактивный: нажатие ничего не выбирает.
    expect(view.getByTestId('saved-filter-type-files')).toBeDisabled();

    await fireEvent.press(view.getByTestId('saved-tag-Работа'));

    await waitFor(() => expect(view.queryByText('про ёжика')).toBeNull());
    expect(mockedList).toHaveBeenLastCalledWith({ before: null }, undefined, { tags: ['tag-w'] });
    expect(mockedPins).toHaveBeenLastCalledWith({ tags: ['tag-w'] });
    expect(view.getByTestId('saved-filter-chip-Работа')).toBeTruthy();

    await fireEvent.press(view.getByTestId('saved-filter-chip-Работа'));

    expect(await view.findByText('про ёжика')).toBeTruthy();
    expect(view.queryByTestId('saved-filter-bar')).toBeNull();
  });

  it('a tag tapped on a bubble filters at once; tapping it again changes nothing', async () => {
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('saved-bubble-tag-Работа'));

    expect(await view.findByTestId('saved-filter-chip-Работа')).toBeTruthy();
    await waitFor(() => expect(view.queryByText('про ёжика')).toBeNull());

    await fireEvent.press(view.getByTestId('saved-bubble-tag-Работа'));

    expect(getSavedFilters().tags).toEqual(['tag-w']);
  });

  it('nothing under the filters — «Ничего не найдено» with «Сбросить фильтры»', async () => {
    const view = await renderScreen();
    expect(await view.findByText('про ёжика')).toBeTruthy();

    await act(() => {
      // Как выбор «Мои заметки» в листе.
      useSavedFiltersStore.setState({ categories: ['note'] });
    });

    expect(await view.findByTestId('saved-filter-empty')).toBeTruthy();

    await fireEvent.press(view.getByText('Сбросить фильтры'));

    expect(await view.findByText('про ёжика')).toBeTruthy();
  });

  it('the same filters narrow «Посмотреть позже»', async () => {
    mockedLater.mockResolvedValue({ items: [], nextCursor: null });
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('saved-bubble-tag-Работа'));
    await fireEvent.press(view.getByTestId('segment-1'));

    await waitFor(() =>
      expect(mockedLater).toHaveBeenLastCalledWith(null, { tags: ['tag-w'] }),
    );
    expect(await view.findByTestId('watch-later-nothing-found')).toBeTruthy();
    expect(view.getByTestId('saved-filter-chip-Работа')).toBeTruthy();
  });
});

describe('SavedScreen — поиск', () => {
  it('search on «Все» counts matches under the filters and closes back to the note field', async () => {
    const view = await renderScreen();
    expect(await view.findByText('про ёжика')).toBeTruthy();

    await fireEvent.press(await view.findByTestId('saved-search-open'));
    await fireEvent.changeText(await view.findByTestId('chat-search-input'), 'ёжик');

    await waitFor(() =>
      expect(view.getByTestId('chat-search-counter')).toHaveTextContent('1 из 1'),
    );
    expect(mockedCount).toHaveBeenLastCalledWith({ q: 'ёжик' }, expect.anything());

    await fireEvent.press(view.getByTestId('chat-search-list'));
    expect(await view.findByTestId('saved-search-result')).toHaveTextContent(/ёжика/);

    await fireEvent.press(view.getByTestId('chat-search-input-close'));

    await waitFor(() => expect(view.queryByTestId('chat-search-plate')).toBeNull());
    expect(view.queryByTestId('chat-search-input')).toBeNull();
  });

  it('nothing found — said on the plate', async () => {
    const view = await renderScreen();

    await fireEvent.press(await view.findByTestId('saved-search-open'));
    await fireEvent.changeText(await view.findByTestId('chat-search-input'), 'зебра');

    await waitFor(() =>
      expect(view.getByTestId('chat-search-counter')).toHaveTextContent('Ничего не найдено'),
    );
  });
});

