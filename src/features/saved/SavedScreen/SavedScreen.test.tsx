import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { SavedScreen } from './index';

import type { ChatSummary } from '@/api/chats';
import {
  fetchSourceChats,
  getSavedSource,
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
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/media', () => ({
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
}));

const mockedList = listSavedMessages as jest.MockedFunction<typeof listSavedMessages>;
const mockedChats = fetchSourceChats as jest.MockedFunction<typeof fetchSourceChats>;
const mockedTags = listSavedTags as jest.MockedFunction<typeof listSavedTags>;
const mockedSource = getSavedSource as jest.MockedFunction<typeof getSavedSource>;

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
    sourceSeq: 42,
    commentMessageId: null,
    commentPopId: null,
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
    mockedList.mockResolvedValue({ items: [], nextCursor: null, prevCursor: null });

    await renderWithQuery(<SavedScreen />);

    expect(await screen.findByTestId('saved-empty')).toBeTruthy();
    expect(screen.getByText(/нажмите «Переслать»/)).toBeTruthy();
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
      prevCursor: null,
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
      prevCursor: null,
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

  it('opens the original scrolled to it, and only says so when it is gone', async () => {
    mockedList.mockResolvedValue({ items: [saved('a')], nextCursor: null, prevCursor: null });
    mockedSource.mockResolvedValueOnce({
      state: 'live',
      chatId: 'chat-g',
      channelId: null,
      messageId: 'msg-a',
      seq: 42,
      commentId: null,
      popId: null,
      popChannelId: null,
    });

    await renderWithQuery(<SavedScreen />);
    await fireEvent.press(await screen.findByTestId('saved-source'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/[chatId]',
        params: expect.objectContaining({ chatId: 'chat-g', jumpTo: 'msg-a', jumpSeq: '42' }),
      }),
    );

    mockedSource.mockResolvedValueOnce({
      state: 'original_gone',
      chatId: 'chat-g',
      channelId: null,
    });
    await fireEvent.press(screen.getByTestId('saved-source'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/chats/[chatId]',
        params: { chatId: 'chat-g' },
      }),
    );
    expect(useInAppAlert.getState().alert).toMatchObject({ text: 'Оригинал удалён' });
  });

  it('opens the comments sheet on a saved comment', async () => {
    mockedList.mockResolvedValue({
      items: [saved('a', { sourceType: 'comment', sourceCommentId: 'com-1' })],
      nextCursor: null,
      prevCursor: null,
    });
    mockedSource.mockResolvedValueOnce({
      state: 'live',
      chatId: 'chat-g',
      channelId: null,
      messageId: 'msg-under',
      seq: 7,
      commentId: 'com-1',
      popId: null,
      popChannelId: null,
    });

    await renderWithQuery(<SavedScreen />);
    await fireEvent.press(await screen.findByTestId('saved-source'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/[chatId]',
        params: expect.objectContaining({
          comments: 'msg-under',
          comment: 'com-1',
          jumpTo: 'msg-under',
        }),
      }),
    );
  });
});
