jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen } from '@testing-library/react-native';
import { BackHandler, FlatList } from 'react-native';

import { ChatRoute as ChatScreen } from '@/navigation/screens/ChatRoute';

import type { ChatSummary, ForwardedComment, Message } from '@/api/chats';
import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import { getCommentTarget, listCommentThreadRoots, subscribeToComments } from '@/api/comments';
import { listPinnedMessages } from '@/api/pins';
import { NO_REACTIONS } from '@/api/reactionCounts';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { renderWithQuery } from '@/test/renderWithQuery';

type Route = { name: string; key: string; params?: Record<string, string> };

const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockParams: Record<string, string> = { chatId: 'chat-1' };
let mockStack: { index: number; routes: Route[] } = { index: 0, routes: [] };

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => mockStack,
    dispatch: mockDispatch,
    addListener: () => () => undefined,
  }),
  useRouteParams: () => mockParams,
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  ScreenOptions: () => null,
}));

jest.mock('@/features/pops/openPopViewer', () => ({ openPopViewer: jest.fn() }));
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
  getPinnedComment: jest.fn(() => Promise.resolve(null)),
  pinComment: jest.fn(() => Promise.resolve()),
  unpinComment: jest.fn(() => Promise.resolve()),
  COMMENT_PAGE_SIZE: 30,
  COMMENT_THREAD_PAGE_SIZE: 10,
  listCommentThreadRoots: jest.fn(),
  listCommentThreadReplies: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
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
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  VoicePlayer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  // Строка ввода как есть; справа — «Отправить», когда она стоит на месте микрофона.
  HoldToRecordRow: ({ children, trailing }: { children: unknown; trailing?: unknown }) =>
    jest.requireActual('react').createElement(
      jest.requireActual('react').Fragment,
      null,
      children,
      trailing,
    ),
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const AT = '2026-09-30T10:00:00Z';

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: 'Разговор',
  participants: [
    { id: 'user-1', displayName: 'Марина', avatarUrl: null, lastReadAt: AT },
    { id: 'user-2', displayName: 'Олег', avatarUrl: null, lastReadAt: AT },
  ],
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

function message(id: string, minute: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: `текст ${id}`,
    seq: Date.parse(`2026-09-30T10:0${minute}:00Z`),
    createdAt: `2026-09-30T10:0${minute}:00Z`,
    editedAt: null,
    edited: false,
    editMark: null,
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
    subject: { type: 'message', id: targetId },
    chatId,
    commentThreadRootId: null,
    authorId: 'user-9',
    authorName: 'Гость',
    authorAvatarUrl: null,
    kind: 'text',
    text: 'пересланный комментарий',
    createdAt: '2026-09-30T11:00:00Z',
    editedAt: null,
    attachments: [],
    reactions: NO_REACTIONS,
    fragmentId: null,
    fragmentQuote: null,
    target: {
      id: targetId,
      seq: Date.parse('2026-09-30T10:01:00Z'),
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
    pop: null,
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
  (listCommentThreadRoots as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
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

describe('disabled chat source navigation', () => {
  it('keeps a forwarded comment readable without opening its source chat', async () => {
    await renderChat();
    await fireEvent.press(screen.getByText('Комментарий из «Другой»'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comments-panel')).toBeNull();
    expect(screen.getByTestId('messages-list')).toBeTruthy();
  });

  it('ignores legacy message and comment target parameters', async () => {
    mockParams = { chatId: 'chat-1', jumpTo: 'm1', jumpSeq: AT, jumpKey: '1', comments: 'm1', comment: 'c1' };
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex');
    await renderChat();
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comments-panel')).toBeNull();
    scroll.mockRestore();
  });
});

describe('tapping a forwarded comment to a pop', () => {
  const popComment = (pop: ForwardedComment['pop']) =>
    forwarded('posts-1', 'pop-1', {
      subject: { type: 'pop', id: 'pop-1' },
      target: null,
      pop,
      chat: { id: 'posts-1', name: 'Pop Lab', amMember: false },
    });
  const live = { id: 'pop-1', channelId: 'channel-1', posterUrl: 'https://cdn.test/p.jpg', caption: null };

  it('does not open the pop from the quote', async () => {
    mockedListMessages.mockResolvedValue({ items: withForward(popComment(live)), nextCursor: null });
    await renderChat();

    await fireEvent.press(screen.getByTestId('pop-quote'));

    expect(screen.getByTestId('pop-quote')).toBeDisabled();
    expect(openPopViewer).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not open pop comments from the label', async () => {
    mockedListMessages.mockResolvedValue({ items: withForward(popComment(live)), nextCursor: null });
    await renderChat();

    await fireEvent.press(screen.getByText('Комментарий из «Pop Lab»'));

    expect(openPopViewer).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a deleted pop: «Поп удалён», taps open nothing, the comment stays', async () => {
    mockedListMessages.mockResolvedValue({ items: withForward(popComment(null)), nextCursor: null });
    await renderChat();

    expect(screen.getByText('Поп удалён')).toBeTruthy();
    expect(screen.getByText('пересланный комментарий')).toBeTruthy();

    // Отключённая цитата отдаёт тап облачку — оно открывает своё меню, как у
    // цитаты удалённого сообщения. Поэтому подпись — первой.
    await fireEvent.press(screen.getByText('Комментарий из «Pop Lab»'));
    await fireEvent.press(screen.getByTestId('pop-quote'));

    expect(openPopViewer).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
