import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { SavedScreen } from './index';

import type { ChatSummary } from '@/api/chats';
import {
  fetchSourceChats,
  listSavedMessages,
  listSavedTags,
  type SavedMessage,
} from '@/api/saved';
import { useSession } from '@/features/auth/useSession';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useIsFocused: () => true,
  // Шапка экрана — кнопки поиска и фильтров справа.
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => unknown } }) =>
      options?.headerRight ? options.headerRight() : null,
  },
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
// Поле заметок — своими тестами (SavedScreen.notes.test.tsx).
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
  getSavedSummary: jest.fn(() => Promise.resolve({ watchLaterPending: 0 })),
  listSavedPins: jest.fn(() => Promise.resolve([])),
  listWatchLater: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
}));

const mockedList = listSavedMessages as jest.MockedFunction<typeof listSavedMessages>;
const mockedChats = fetchSourceChats as jest.MockedFunction<typeof fetchSourceChats>;
const mockedTags = listSavedTags as jest.MockedFunction<typeof listSavedTags>;

function chat(id: string, title: string, channel = false): ChatSummary {
  return {
    id,
    kind: channel ? 'channel' : 'group',
    ownerId: null,
    description: null,
    avatarUrl: null,
    title: channel ? null : title,
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
    channel: channel ? { id: 'ch-1', title, username: 'tm', avatarUrl: null } : null,
  };
}

function saved(id: string, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id,
    seq: 1,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'visitor',
    sourceChatId: 'chat-g',
    sourceMessageId: `msg-${id}`,
    sourceCommentId: null,
    kind: 'text',
    text: `текст ${id}`,
    authorId: 'user-anna',
    authorName: 'Анна',
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: '2026-10-19T08:30:00Z',
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

beforeEach(() => {
  jest.clearAllMocks();
  useInAppAlert.setState({ alert: null });
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedTags.mockResolvedValue([{ id: 'tag-w', name: 'Работа', color: 0, usesCount: 1 }]);
  mockedChats.mockResolvedValue(
    new Map([
      ['chat-g', chat('chat-g', 'Группа')],
      ['chat-c', chat('chat-c', 'Типичная Москва', true)],
    ]),
  );
});

describe('SavedScreen', () => {
  it('explains how to save when nothing is saved yet', async () => {
    mockedList.mockResolvedValue({ items: [], nextCursor: null });

    await renderWithQuery(<SavedScreen />);

    expect(await screen.findByTestId('saved-empty')).toBeTruthy();
    expect(screen.getByText(/Напишите заметку внизу или сохраните сообщение/)).toBeTruthy();
  });

  it('labels a group copy «Группа · Анна» and a channel post with the channel only', async () => {
    mockedList.mockResolvedValue({
      items: [
        saved('a'),
        saved('b', {
          sourceChatId: 'chat-c',
          category: 'channel',
          authorName: 'Владелец канала',
        }),
        saved('c', { sourceChatId: null }),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<SavedScreen />);

    expect(await screen.findByText('текст a')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('saved-row-a')).getByTestId('saved-source'),
      ).toHaveTextContent('Группа · Анна'),
    );
    expect(within(screen.getByTestId('saved-row-b')).getByTestId('saved-source')).toHaveTextContent(
      'Типичная Москва',
    );
    expect(screen.queryByText(/Владелец канала/)).toBeNull();
    expect(within(screen.getByTestId('saved-row-c')).getByTestId('saved-source')).toHaveTextContent(
      'Удалённый чат · Анна',
    );
  });

  it('shows tags, the original time when it was visible, and the watch-later circle only when marked', async () => {
    mockedList.mockResolvedValue({
      items: [
        saved('a', { tagIds: ['tag-w'], watchLaterAt: '2026-10-20T10:00:00Z' }),
        saved('b', { originalAt: null }),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<SavedScreen />);

    const marked = within(await screen.findByTestId('saved-row-a'));

    expect(await marked.findByText('Работа')).toBeTruthy();
    expect(marked.getByTestId('saved-watch-later')).not.toBeChecked();
    expect(marked.getByTestId('message-time')).toBeTruthy();

    const plain = within(screen.getByTestId('saved-row-b'));

    expect(plain.queryByTestId('saved-watch-later')).toBeNull();
    expect(plain.queryByTestId('message-time')).toBeNull();
    // Реакций, круга комментариев и просмотров у копии нет.
    expect(screen.queryByTestId('comments-slot')).toBeNull();
  });

  it.each(['message', 'comment', 'pop-comment'] as const)('does not open the source for a saved %s', async (kind) => {
    mockedList.mockResolvedValue({
      items: [saved('a', { sourceType: kind === 'message' ? 'message' : 'comment', sourceCommentId: kind !== 'message' ? 'com-1' : null })],
      nextCursor: null,
    });
    await renderWithQuery(<SavedScreen />);
    const source = await screen.findByTestId('saved-source');
    expect(source.props.accessibilityRole).toBe('text');
    expect(source.props.onPress).toBeUndefined();
    await fireEvent.press(source);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
