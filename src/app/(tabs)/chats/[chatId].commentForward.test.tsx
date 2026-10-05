import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, FlatList } from 'react-native';

import ChatScreen from './[chatId]';

import type { ChatSummary, ForwardedComment, Message } from '@/api/chats';
import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import { getCommentTarget, listThreadRoots, subscribeToComments } from '@/api/comments';
import { listPinnedMessages } from '@/api/pins';
import { NO_REACTIONS } from '@/api/reactionCounts';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { showNotice } from '@/features/notifications/alertsStore';
import { renderWithQuery } from '@/test/renderWithQuery';

type Route = { name: string; key: string; params?: Record<string, string> };

const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockParams: Record<string, string> = { chatId: 'chat-1' };
let mockStack: { index: number; routes: Route[] } = { index: 0, routes: [] };

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => mockStack,
    dispatch: mockDispatch,
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('@/api/profile', () => ({
  getProfile: jest.fn(() => Promise.resolve(null)),
  getMyProfile: jest.fn(() => Promise.resolve({ id: 'user-3', displayName: 'Пётр', avatarUrl: null })),
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/streams');
jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  markChatRead: jest.fn(() => Promise.resolve()),
  sendMessage: jest.fn(),
  subscribeToChat: jest.fn(),
  subscribeToChatSignals: jest.fn(() => () => undefined),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/comments', () => ({
  COMMENT_PAGE_SIZE: 30,
  THREAD_PAGE_SIZE: 10,
  listThreadRoots: jest.fn(),
  listThreadReplies: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  fetchComment: jest.fn(),
  listCommentsByIds: jest.fn(() => Promise.resolve([])),
  getCommentTarget: jest.fn(),
  sendComment: jest.fn(),
  sendVoiceComment: jest.fn(),
  deleteComment: jest.fn(),
  editComment: jest.fn(),
  setCommentReaction: jest.fn(),
  listCommentReactions: jest.fn(() => Promise.resolve([])),
  subscribeToComments: jest.fn(() => () => undefined),
}));
jest.mock('@/api/messageViews');
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(),
  pinMessage: jest.fn(),
  unpinMessage: jest.fn(),
}));
jest.mock('@/api/invites', () => ({
  getMyInvite: jest.fn(() => Promise.resolve(null)),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));
jest.mock('@/components/ConfirmDialog', () => ({
  confirm: jest.fn(),
  ConfirmDialogSurface: () => null,
}));
jest.mock('@/features/notifications/alertsStore', () => ({
  ...jest.requireActual('@/features/notifications/alertsStore'),
  showNotice: jest.fn(),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  VoicePlayer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  HoldToRecordRow: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const AT = '2026-09-30T10:00:00Z';

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: 'Разговор',
  participants: [
    { id: 'user-1', displayName: 'Марина', avatarUrl: null, lastReadAt: AT },
    { id: 'user-2', displayName: 'Олег', avatarUrl: null, lastReadAt: AT },
  ],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  hasUnread: false,
};

function message(id: string, minute: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: `текст ${id}`,
    createdAt: `2026-09-30T10:0${minute}:00Z`,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    ...overrides,
  };
}

/** Комментарий к сообщению `targetId` из чата `chatId`, пересланный сюда. */
function forwarded(
  chatId: string,
  targetId: string,
  overrides: Partial<ForwardedComment> = {},
): ForwardedComment {
  return {
    id: 'c1',
    messageId: targetId,
    chatId,
    threadRootId: null,
    authorId: 'user-9',
    authorName: 'Гость',
    authorAvatarUrl: null,
    kind: 'text',
    text: 'пересланный комментарий',
    createdAt: '2026-09-30T11:00:00Z',
    editedAt: null,
    attachments: [],
    reactions: NO_REACTIONS,
    target: {
      id: targetId,
      createdAt: '2026-09-30T10:01:00Z',
      authorId: 'user-1',
      authorName: 'Марина',
      preview: {
        kind: 'text',
        text: 'исходное сообщение',
        thumbnailUrl: null,
        mediaCount: 0,
        firstMediaIsVideo: false,
        durationMs: null,
      },
    },
    chat: { id: chatId, name: chatId === 'chat-1' ? 'Разговор' : 'Другой', amMember: false },
    ...overrides,
  };
}

function withForward(comment: ForwardedComment): Message[] {
  return [
    message('f1', 5, {
      kind: 'comment_forward',
      text: null,
      authorId: 'user-2',
      commentForward: { commentId: comment.id, comment },
    }),
    message('m2', 2),
    message('m1', 1),
  ];
}

const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedShowNotice = showNotice as jest.MockedFunction<typeof showNotice>;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { chatId: 'chat-1' };
  mockStack = { index: 0, routes: [] };
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  closeComments();
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-3' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  (getChat as jest.Mock).mockResolvedValue(chat);
  mockedListMessages.mockResolvedValue({ items: withForward(forwarded('chat-2', 'm9')), nextCursor: null });
  (listPinnedMessages as jest.Mock).mockResolvedValue([]);
  (listDeletedMessageIds as jest.Mock).mockResolvedValue([]);
  (subscribeToChat as jest.Mock).mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
  (listThreadRoots as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  (getCommentTarget as jest.Mock).mockImplementation(async (messageId: string) => ({
    state: 'live',
    message: message(messageId, 1),
    authorName: 'Марина',
    authorAvatarUrl: null,
  }));
  (subscribeToComments as jest.Mock).mockReturnValue(() => undefined);
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: () => undefined }));
});

async function renderChat() {
  await renderWithQuery(<ChatScreen />);
  await screen.findByText('текст m2');
}

describe('tapping a forwarded comment', () => {
  it('opens the source chat with its sheet and a jump to the commented message', async () => {
    await renderChat();

    await fireEvent.press(screen.getByText('Комментарий из «Другой»'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: {
        chatId: 'chat-2',
        comments: 'm9',
        comment: 'c1',
        jumpTo: 'm9',
        jumpAt: '2026-09-30T10:01:00Z',
        jumpKey: expect.any(String),
      },
    });
  });

  it('returns to the source chat already open below — no second copy', async () => {
    mockStack = {
      index: 1,
      routes: [
        { name: '[chatId]', key: 'chat-b', params: { chatId: 'chat-2', jumpTo: 'old' } },
        { name: '[chatId]', key: 'chat-a', params: { chatId: 'chat-1' } },
      ],
    };

    await renderChat();
    await fireEvent.press(screen.getByText('исходное сообщение'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMS',
      payload: {
        params: expect.objectContaining({
          chatId: 'chat-2',
          comments: 'm9',
          comment: 'c1',
          jumpTo: 'm9',
          jumpKey: expect.any(String),
        }),
      },
      source: 'chat-b',
    });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'POP', payload: { count: 1 } });
  });

  it('a deleted commented message: the sheet opens on the way, nothing to jump to', async () => {
    mockStack = {
      index: 1,
      routes: [
        { name: '[chatId]', key: 'chat-b', params: { chatId: 'chat-2', jumpTo: 'old', jumpAt: AT } },
        { name: '[chatId]', key: 'chat-a', params: { chatId: 'chat-1' } },
      ],
    };
    mockedListMessages.mockResolvedValue({
      items: withForward(forwarded('chat-2', 'm9', { target: null })),
      nextCursor: null,
    });

    await renderChat();
    await fireEvent.press(screen.getByText('Комментарий из «Другой»'));

    // Прежний прыжок того экрана стёрт — он не повторится.
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_PARAMS',
        payload: {
          params: expect.objectContaining({ comments: 'm9', jumpTo: undefined, jumpAt: undefined }),
        },
      }),
    );
  });

  it('from this same chat: the sheet opens here and the chat scrolls to the message', async () => {
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
    mockedListMessages.mockResolvedValue({
      items: withForward(forwarded('chat-1', 'm1')),
      nextCursor: null,
    });

    await renderChat();
    await fireEvent.press(screen.getByText('Комментарий из «Разговор»'));

    expect(await screen.findByTestId('comments-panel')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    // m1 — третья строка снизу; ждём, пока шит встанет (в тестах — по таймауту).
    await waitFor(
      () => expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 2 })),
      { timeout: 4000 },
    );
    scrollToIndex.mockRestore();
  });

  it('from this chat, the message since deleted: just the sheet, no “not found” error', async () => {
    mockedListMessages.mockResolvedValue({
      items: withForward(forwarded('chat-1', 'm1', { target: null })),
      nextCursor: null,
    });

    await renderChat();
    await fireEvent.press(screen.getByText('Комментарий из «Разговор»'));

    expect(await screen.findByTestId('comments-panel')).toBeTruthy();
    expect(mockedShowNotice).not.toHaveBeenCalledWith('Не удалось найти сообщение', 'error');
  });
});

describe('arriving at a forwarded comment', () => {
  it('opens the sheet and scrolls to the message by the jump key', async () => {
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
    mockParams = {
      chatId: 'chat-1',
      comments: 'm1',
      comment: 'c1',
      jumpTo: 'm1',
      jumpAt: '2026-09-30T10:01:00Z',
      jumpKey: '1',
    };

    await renderChat();

    expect(await screen.findByTestId('comments-panel')).toBeTruthy();
    await waitFor(
      () => expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 2 })),
      { timeout: 4000 },
    );
    scrollToIndex.mockRestore();
  });
});
