import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import ChatScreen from './[chatId]';

import type { ChatSummary, Message } from '@/api/chats';
import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import {
  getCommentTarget,
  listComments,
  listCommentsSince,
  sendComment,
  subscribeToComments,
  type Comment,
  type CommentChannelHandlers,
} from '@/api/comments';
import { listPinnedMessages } from '@/api/pins';
import { NO_REACTIONS } from '@/api/reactionCounts';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { resetCommentOutbox } from '@/features/interactions/comments/commentOutbox';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('expo-router', () => ({
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
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
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/comments', () => ({
  COMMENT_PAGE_SIZE: 30,
  listComments: jest.fn(),
  listCommentsSince: jest.fn(() => Promise.resolve([])),
  listCommentsByIds: jest.fn(() => Promise.resolve([])),
  getCommentTarget: jest.fn(),
  sendComment: jest.fn(),
  sendVoiceComment: jest.fn(),
  deleteComment: jest.fn(),
  editComment: jest.fn(),
  subscribeToComments: jest.fn(),
}));
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
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
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

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedListComments = listComments as jest.MockedFunction<typeof listComments>;
const mockedSince = listCommentsSince as jest.MockedFunction<typeof listCommentsSince>;
const mockedTarget = getCommentTarget as jest.MockedFunction<typeof getCommentTarget>;
const mockedSend = sendComment as jest.MockedFunction<typeof sendComment>;
const mockedSubscribeComments = subscribeToComments as jest.MockedFunction<
  typeof subscribeToComments
>;

const AT = '2026-09-30T10:00:00Z';
const author = { id: 'user-1', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };
const partner = { id: 'user-2', displayName: 'Олег', avatarUrl: null, lastReadAt: AT };

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: 'Разговор',
  participants: [author, partner],
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
    ...overrides,
  };
}

const photo = {
  id: 'a1',
  url: 'https://x/1.jpg',
  posterUrl: null,
  mimeType: 'image/jpeg',
  width: 100,
  height: 80,
  durationMs: null,
  waveform: null,
};

const voice = {
  ...photo,
  id: 'a2',
  url: 'https://x/v.m4a',
  mimeType: 'audio/mp4',
  width: null,
  height: null,
  durationMs: 4000,
  waveform: [1, 5, 31],
};

const MESSAGES = [
  message('m5', 5, { kind: 'system', text: 'служебное', authorId: null }),
  message('m4', 4, {
    commentsCount: 1,
    forward: { authorId: 'user-2', authorName: 'Олег', original: null },
  }),
  message('m3', 3, { kind: 'voice', text: null, attachments: [voice], commentsCount: 5 }),
  message('m2', 2, { kind: 'media', text: null, attachments: [photo], commentsCount: 2 }),
  message('m1', 1),
];

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    messageId: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    authorName: 'Олег',
    authorAvatarUrl: null,
    audience: 'member',
    kind: 'text',
    text: `комментарий ${id}`,
    createdAt: '2026-09-30T11:00:00Z',
    editedAt: null,
    attachments: [],
    ...overrides,
  };
}

let commentHandlers: CommentChannelHandlers | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  commentHandlers = null;
  resetOutbox();
  resetCommentOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  closeComments();
  // Смотрит посетитель: в чате Марина и Олег, а вошёл Пётр.
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-3' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedGetChat.mockResolvedValue(chat);
  mockedListMessages.mockResolvedValue({ items: MESSAGES, nextCursor: null });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
  mockedListComments.mockResolvedValue({ items: [], nextCursor: null });
  mockedTarget.mockImplementation(async (messageId) => ({
    state: 'live',
    message: MESSAGES.find((item) => item.id === messageId)!,
    authorName: 'Марина',
    authorAvatarUrl: null,
  }));
  mockedSubscribeComments.mockImplementation((_messageId, handlers) => {
    commentHandlers = handlers;
    return () => undefined;
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: () => undefined }));
});

async function renderChat() {
  await renderWithQuery(<ChatScreen />);
  await screen.findByText('текст m1');
}

/** Кружки комментариев в порядке списка — самое новое первым. */
function buttons() {
  return screen.getAllByTestId('comments-button');
}

async function openCommentsOf(index: number) {
  await fireEvent.press(buttons()[index]);
  await screen.findByTestId('comments-panel');
}

function commentField() {
  return screen.getByPlaceholderText('Комментарий');
}

describe('comments button next to the bubble', () => {
  it('sits next to text, a bare album, a voice note and a forwarded message — not a system one', async () => {
    await renderChat();

    // m4 переслано, m3 голосовое, m2 альбом без подписи, m1 текст; m5 — системное.
    expect(buttons()).toHaveLength(4);
    expect(within(buttons()[0]).getByText('1')).toBeTruthy();
    expect(within(buttons()[1]).getByText('5')).toBeTruthy();
    expect(within(buttons()[2]).getByText('2')).toBeTruthy();
  });

  it('shows only the icon while there are no comments', async () => {
    await renderChat();

    expect(within(buttons()[3]).queryByText(/\d/)).toBeNull();
    expect(buttons()[3].props.accessibilityLabel).toBe('Комментарии');
  });

  it('updates the count when the chat reports new comments', async () => {
    const { listCommentCounts } = jest.requireMock('@/api/chats') as {
      listCommentCounts: jest.Mock;
    };
    listCommentCounts.mockResolvedValue([{ id: 'm1', commentsCount: 7 }]);

    await renderChat();

    const handlers = mockedSubscribe.mock.calls[0][1];
    await act(async () => handlers.onCommentsChanged('m1'));

    await waitFor(() => expect(within(buttons()[3]).getByText('7')).toBeTruthy(), {
      timeout: 2000,
    });
  });
});

describe('comments panel', () => {
  it('opens with the message on top, an honest empty state and a field — for a visitor too', async () => {
    await renderChat();

    // В самой переписке посетитель писать не может…
    expect(screen.getByText('Читать этот чат может кто угодно, писать — только участники.')).toBeTruthy();

    await openCommentsOf(3);

    expect(
      await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('comment-target')).getByText('текст m1')).toBeTruthy();
    // …а комментировать — может.
    expect(commentField()).toBeTruthy();
  });

  it('shows comments as a chat with a quiet mark next to chat members', async () => {
    mockedListComments.mockResolvedValue({
      items: [comment('c2', { audience: 'visitor', authorName: 'Гость' }), comment('c1')],
      nextCursor: null,
    });

    await renderChat();
    await openCommentsOf(3);

    expect(await screen.findByText('комментарий c1')).toBeTruthy();
    expect(screen.getByText('комментарий c2')).toBeTruthy();
    expect(screen.getAllByText(/участник чата/)).toHaveLength(1);
  });

  it('closes with the cross, the backdrop and the system back', async () => {
    await renderChat();

    await openCommentsOf(3);
    await fireEvent.press(screen.getAllByLabelText('Закрыть комментарии')[1]);
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());

    await openCommentsOf(3);
    await fireEvent.press(screen.getByTestId('comments-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());

    await openCommentsOf(3);
    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());
  });

  it('keeps a separate draft for every message across closing the panel', async () => {
    await renderChat();

    await openCommentsOf(3);
    await fireEvent.changeText(commentField(), 'к первому');
    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());

    await openCommentsOf(0);
    expect(commentField().props.value).toBe('');
    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());

    await openCommentsOf(3);
    expect(commentField().props.value).toBe('к первому');
  });

  it('shows the sent comment at once and offers retry when the server refuses', async () => {
    let refuse: (cause: unknown) => void = () => undefined;
    mockedSend.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.');

    await fireEvent.changeText(commentField(), 'мой комментарий');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(await screen.findByText('мой комментарий')).toBeTruthy();
    expect(screen.getByText('Отправляется…')).toBeTruthy();
    expect(commentField().props.value).toBe('');
    expect(mockedSend).toHaveBeenCalledWith('m1', { text: 'мой комментарий', media: [] });

    await act(async () => refuse({ code: '42501', message: 'denied' }));

    expect(await screen.findByText('Не отправлено. Повторить')).toBeTruthy();
    expect(screen.getByText('мой комментарий')).toBeTruthy();
  });

  it('shows somebody else’s new comment in real time', async () => {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.');

    mockedSince.mockResolvedValue([comment('c9', { text: 'только что' })]);
    mockedListComments.mockResolvedValue({ items: [comment('c9', { text: 'только что' })], nextCursor: null });
    await act(async () => commentHandlers!.onAdded('c9'));

    expect(await screen.findByText('только что', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('says the message is deleted and stops taking new comments', async () => {
    mockedTarget.mockResolvedValue({ state: 'deleted' });

    await renderChat();
    await openCommentsOf(3);

    expect(await screen.findByText('Сообщение удалено')).toBeTruthy();
    expect(screen.getByText('Сообщение удалено — новые комментарии не принимаются.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Комментарий')).toBeNull();
  });
});
