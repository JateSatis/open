jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { ChatRoute as ChatScreen } from '@/navigation/screens/ChatRoute';

import type { ChatSummary, Message } from '@/api/chats';

import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import {
  getCommentTarget,
  listCommentsByIds,
  listCommentThreadReplies,
  listCommentThreadRoots,
  sendComment,
  setCommentReaction,
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
import { exitFragmentMode } from '@/features/chats/fragments/fragmentStore';
import {
  closeComments,
  openFragmentComments,
} from '@/features/interactions/comments/commentsPanelStore';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { island, original } from '@/test/islands';
import { renderWithQuery } from '@/test/renderWithQuery';
import { longPressMessage, startSelecting } from '@/test/messageGestures';

let mockFocused = true;
const mockPush = jest.fn();
/** Последние строки, отданные каждому списку, — по `testID` списка. */
const mockListRows: Record<string, { key: string }[]> = {};

jest.mock('@shopify/flash-list', () => {
  const actual = jest.requireActual('@shopify/flash-list');
  const { forwardRef, createElement } = jest.requireActual('react');

  return {
    ...actual,
    FlashList: forwardRef((props: { data: { key: string }[]; testID?: string }, ref: unknown) => {
      mockListRows[props.testID ?? ''] = props.data;

      return createElement(actual.FlashList, { ...props, ref });
    }),
  };
});

jest.mock('@/navigation', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRouteParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  ScreenOptions: () => null,
}));

jest.mock('@/api/profile', () => ({
  getProfile: jest.fn(() => Promise.resolve(null)),
  getMyProfile: jest.fn(() =>
    Promise.resolve({ id: 'user-3', displayName: 'Пётр', avatarUrl: null }),
  ),
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
  subscribeToComments: jest.fn(),
}));
jest.mock('@/api/messageViews');
jest.mock('@/api/fragments', () => ({
  listMessageFragments: jest.fn(() => Promise.resolve([])),
  setFragmentReaction: jest.fn(),
}));
// Геометрия текста облачка: одна строка, по 10 dp на символ.
jest.mock('../../../../modules/text-geometry', () => ({
  textGeometryAvailable: true,
  measureText: jest.fn((view: { props?: { children?: unknown } } | null) => {
    const text = String(view?.props?.children ?? '');

    return Promise.resolve({
      text,
      width: text.length * 10,
      height: 20,
      lines: [
        {
          start: 0,
          end: text.length,
          top: 0,
          bottom: 20,
          baseline: 16,
          left: 0,
          right: text.length * 10,
        },
      ],
      xs: Array.from({ length: text.length }, (_, i) => i * 10),
    });
  }),
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

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedListComments = listCommentThreadRoots as jest.MockedFunction<typeof listCommentThreadRoots>;
const mockedReplies = listCommentThreadReplies as jest.MockedFunction<typeof listCommentThreadReplies>;
const mockedByIds = listCommentsByIds as jest.MockedFunction<typeof listCommentsByIds>;
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
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: 'Разговор',
  participants: [author, partner],
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
  // Островок: кружок комментариев — у оригинала внутри, не у самого островка.
  island('m4', '2026-09-30T10:04:00Z', [
    original({
      id: 'o4',
      chatId: 'chat-1',
      commentsCount: 1,
      viewsCount: 0,
      readAt: null,
      chat: {
        id: 'chat-1',
        name: 'Разговор',
        readUpTo: null,
        amMember: true,
        isChannelPosts: false,
      },
    }),
  ]),
  message('m3', 3, { kind: 'voice', text: null, attachments: [voice], commentsCount: 5 }),
  message('m2', 2, { kind: 'media', text: null, attachments: [photo], commentsCount: 2 }),
  message('m1', 1),
];

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    targetId: 'm1',
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
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    commentThreadRootId: null,
    fragmentId: null,
    fragmentQuote: null,
    repliesCount: 0,
    rank: 0,
    deleted: false,
    ...overrides,
  };
}

let commentHandlers: CommentChannelHandlers | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
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
    // Оригинал островка — внутри островка, а не среди сообщений чата.
    message: MESSAGES.flatMap((item) => [
      item,
      ...(item.forward?.items.flatMap((entry) => (entry.original ? [entry.original] : [])) ?? []),
    ]).find((item) => item.id === messageId)!,
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
  // History is requested only after the route has resolved the chat kind.
  await waitFor(() => expect(listMessages).toHaveBeenCalled());
  await screen.findByText('текст m1');
}

/** Кружки комментариев в порядке списка — самое новое первым. */
function buttons() {
  return screen.getAllByTestId('comments-circle');
}

async function openCommentsOf(index: number) {
  await fireEvent.press(buttons()[index]);
  await screen.findByTestId('comments-panel');
}

function commentField() {
  return screen.getByPlaceholderText('Комментарий');
}

/**
 * Строки списка комментариев по порядку экрана. Дерево тут не годится:
 * `FlashList` переиспользует ячейки, и порядок узлов не равен порядку строк.
 */
function rowKeys(list = 'comments-list'): string[] {
  return (mockListRows[list] ?? []).map((row) => row.key);
}

describe('comments circle next to the bubble', () => {
  it('sits next to text, a bare album, a voice note and a forwarded original — not a system one', async () => {
    await renderChat();

    // m4 — островок с одним оригиналом, m3 голосовое, m2 альбом без подписи,
    // m1 текст; m5 — системное.
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

describe('a member and the comments circle', () => {
  beforeEach(() => {
    mockedSession.mockReturnValue({
      session: { user: { id: 'user-2' } } as unknown as SupabaseSession,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('shows no circle while a message has no comments yet', async () => {
    await renderChat();

    // o4, m3 и m2 с комментариями; у m1 их нет — и круга нет.
    expect(buttons()).toHaveLength(3);
    expect(
      within(screen.getByTestId('message-row-m1')).queryByTestId('comments-circle'),
    ).toBeNull();
  });

  it('writes the first comment from the message menu', async () => {
    await renderChat();

    await longPressMessage('m1');
    fireEvent.press(await screen.findByRole('menuitem', { name: 'Комментировать' }));

    expect(await screen.findByTestId('comments-panel')).toBeTruthy();
    expect(
      await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.'),
    ).toBeTruthy();
    expect(commentField()).toBeTruthy();
  });
});

describe('comments panel', () => {
  it('opens with only the comments inside, an honest empty state and a field — for a visitor too', async () => {
    await renderChat();

    // В самой переписке посетитель писать не может — только подписаться…
    expect(await screen.findByTestId('chat-subscribe-button')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Сообщение')).toBeNull();

    await openCommentsOf(3);

    expect(
      await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.'),
    ).toBeTruthy();
    // Самого сообщения в шите нет — оно поднимается над шитом из переписки.
    expect(within(screen.getByTestId('comments-panel')).queryByText('текст m1')).toBeNull();
    // …а комментировать — может.
    expect(commentField()).toBeTruthy();
  });

  it('shows top-level comments in rank order with a quiet mark next to chat members', async () => {
    mockedListComments.mockResolvedValue({
      items: [comment('c2', { audience: 'visitor', authorName: 'Гость' }), comment('c1')],
      nextCursor: null,
    });

    await renderChat();
    await openCommentsOf(3);

    expect(await screen.findByText('комментарий c1')).toBeTruthy();
    // Порядок — как отдала база по рангу, без пересортировки на клиенте.
    expect(rowKeys()).toEqual(['c2', 'c1']);
    expect(screen.getAllByText(/участник чата/)).toHaveLength(1);
  });

  it('has no cross and closes with the backdrop and the system back', async () => {
    await renderChat();

    await openCommentsOf(3);
    // Закрыть можно только тапом над шитом: в шапке кнопки нет.
    expect(screen.getAllByLabelText('Закрыть комментарии')).toHaveLength(1);
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
    expect(screen.getByLabelText('Отправляется')).toBeTruthy();
    expect(commentField().props.value).toBe('');
    expect(mockedSend).toHaveBeenCalledWith('m1', {
      text: 'мой комментарий',
      media: [],
      replyTo: [],
      commentThreadRootId: null,
    });

    await act(async () => refuse({ code: '42501', message: 'denied' }));

    expect(await screen.findByLabelText('Не отправлено. Повторить')).toBeTruthy();
    expect(screen.getByText('мой комментарий')).toBeTruthy();
  });

  it('does not slip somebody else’s new top-level comment into the list — it shows on the next open', async () => {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('Комментариев пока нет. Их увидит каждый, кто откроет этот чат.');

    mockedByIds.mockResolvedValue([comment('c9', { text: 'только что' })]);
    await act(async () => commentHandlers!.onAdded?.('c9', null));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)));

    expect(screen.queryByText('только что')).toBeNull();

    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());

    mockedListComments.mockResolvedValue({
      items: [comment('c9', { text: 'только что' })],
      nextCursor: null,
    });
    await openCommentsOf(3);

    expect(await screen.findByText('только что')).toBeTruthy();
  });

  it('keeps my freshly sent comment at the very top', async () => {
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });
    mockedSend.mockResolvedValue(
      comment('mine', { authorId: 'user-3', text: 'мой', authorName: 'Пётр' }),
    );

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await fireEvent.changeText(commentField(), 'мой');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() => expect(rowKeys()).toEqual(['mine', 'c1']));
  });

  it('leaves the message where it is under the sheet, without a copy above it', async () => {
    await renderChat();
    await openCommentsOf(3);
    await fireEvent(screen.getByTestId('comments-panel'), 'show');

    expect(screen.getByTestId('message-row-m1')).toBeTruthy();
    expect(screen.getAllByText('текст m1')).toHaveLength(1);
  });

  it('says the message is deleted and stops taking new comments', async () => {
    mockedTarget.mockResolvedValue({ state: 'deleted' });

    await renderChat();
    await openCommentsOf(3);

    expect(
      await screen.findByText('Сообщение удалено — новые комментарии не принимаются.'),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Комментарий')).toBeNull();
  });
});

describe('a visitor in the comments', () => {
  /** Долгое нажатие на облачко комментария — его меню. */
  const tapComment = longPressMessage;

  it('puts a reaction on a comment from its menu, and it lands in the one row of the comment at once', async () => {
    const mockedReact = setCommentReaction as jest.MockedFunction<typeof setCommentReaction>;
    mockedReact.mockResolvedValue({ emoji: '🔥', audience: 'visitor' });
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByTestId('reaction-option-🔥'));

    await waitFor(() => expect(mockedReact).toHaveBeenCalledWith('c1', '🔥'));
    // У комментария строки зрителей нет: реакция — в общем ряду.
    expect(await screen.findByLabelText('🔥 1')).toBeTruthy();
    expect(screen.queryByTestId('visitor-reactions')).toBeNull();
  });

  it('replying to a top-level comment opens its comment thread: no quote, the message goes into it', async () => {
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));

    // Окно треда — даже у комментария без ответов: в нём один корень.
    expect(await screen.findByText('Ответы')).toBeTruthy();
    expect(rowKeys('comment-thread-list')).toEqual(['c1']);
    expect(screen.queryByText('В ответ Олег')).toBeNull();

    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'согласен');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'согласен',
        media: [],
        replyTo: [],
        commentThreadRootId: 'c1',
      }),
    );
    // Остаёмся в треде, свой ответ — в его конце.
    expect(screen.getByText('Ответы')).toBeTruthy();
    expect(rowKeys('comment-thread-list')[1]).toMatch(/^local-/);
  });

  it('offers no editing or deleting on somebody else’s comment, but lets forward it', async () => {
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await screen.findByTestId('message-menu');

    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Удалить' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Переслать' })).toBeTruthy();
  });

  it('forwarding from an island original: the chat under the picker is this screen, not the original’s', async () => {
    // Островок здесь, в chat-1, а оригинал — из chat-2: шит открыт с chatId оригинала.
    mockedListMessages.mockResolvedValue({
      items: [
        island('m4', '2026-09-30T10:04:00Z', [
          original({
            id: 'o4',
            chatId: 'chat-2',
            commentsCount: 1,
            viewsCount: 0,
            readAt: null,
            chat: {
              id: 'chat-2',
              name: 'Другой',
              readUpTo: null,
              amMember: false,
              isChannelPosts: false,
            },
          }),
        ]),
        message('m1', 1),
      ],
      nextCursor: null,
    });
    mockedListComments.mockResolvedValue({
      items: [comment('c1', { targetId: 'o4', chatId: 'chat-2' })],
      nextCursor: null,
    });

    await renderChat();
    await openCommentsOf(0);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Переслать' }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        name: 'Forward',
        params: { from: 'chat-1' },
      }),
    );
  });
});

describe('comment threads', () => {
  const root = comment('root', { repliesCount: 2, text: 'корень' });
  const replies = [
    comment('r1', {
      commentThreadRootId: 'root',
      text: 'первый ответ',
      createdAt: '2026-09-30T11:01:00Z',
    }),
    comment('r2', {
      commentThreadRootId: 'root',
      text: 'второй ответ',
      createdAt: '2026-09-30T11:02:00Z',
    }),
  ];

  beforeEach(() => {
    mockedListComments.mockResolvedValue({
      items: [root, comment('other', { text: 'другой корень' })],
      nextCursor: null,
    });
    mockedReplies.mockResolvedValue({ items: replies, nextCursor: null });
  });

  async function openCommentThread() {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');
    await fireEvent.press(screen.getByLabelText('Показать 2 ответа'));
    await screen.findByText('второй ответ');
  }

  /** Долгое нажатие на облачко комментария — его меню. */
  const tapComment = longPressMessage;

  it('puts the replies button only under a comment with replies and opens nothing in the list', async () => {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');

    expect(screen.getAllByTestId('comment-thread-open')).toHaveLength(1);
    expect(screen.queryByText('первый ответ')).toBeNull();
    expect(rowKeys()).toEqual(['root', 'other']);
  });

  it('opens the comment thread window by the button: the root first on its own background, then the replies', async () => {
    await openCommentThread();

    expect(screen.getByText('Ответы')).toBeTruthy();
    expect(screen.getByLabelText('Назад к комментариям')).toBeTruthy();
    expect(rowKeys('comment-thread-list')).toEqual(['root', 'r1', 'r2']);
    expect(screen.getByTestId('comment-thread-root')).toBeTruthy();
    // Основной список не тронут — тред под корнем не раскрывается.
    expect(rowKeys()).toEqual(['root', 'other']);
    expect(mockedReplies).toHaveBeenCalledWith('root');
  });

  it('a message without a quote in the comment thread window goes into the comment thread, at its end', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await openCommentThread();

    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'и я');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'и я',
        media: [],
        replyTo: [],
        commentThreadRootId: 'root',
      }),
    );

    const keys = rowKeys('comment-thread-list');

    expect(keys.slice(0, 3)).toEqual(['root', 'r1', 'r2']);
    expect(keys[3]).toMatch(/^local-/);
    // Число на кнопке в основном списке считает и неотправленный.
    expect(screen.getByLabelText('Показать 3 ответа')).toBeTruthy();
  });

  it('a reply to a reply goes into the same comment thread with its quote', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await openCommentThread();

    await tapComment('r2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));
    expect(await screen.findByText('В ответ Олег')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'и я');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'и я',
        media: [],
        replyTo: ['r2'],
        commentThreadRootId: 'root',
      }),
    );
  });

  it.each(['sheet', 'area', 'cluster'] as const)('keeps reply quotes inert in the %s panel without loading a distant target', async (panel) => {
    const quotedReply = comment('r2', {
      commentThreadRootId: 'root',
      text: 'ответ с цитатой',
      replies: [{
        messageId: 'distant', state: 'live', authorId: 'user-2', authorName: 'Олег',
        seq: 1, createdAt: '2026-09-30T10:00:00Z', editMark: null,
        preview: { kind: 'text', text: 'далёкий ответ', thumbnailUrl: null, mediaCount: 0, firstMediaIsVideo: false, durationMs: null },
      }],
    });
    mockedReplies.mockResolvedValue({ items: [quotedReply], nextCursor: { createdAt: quotedReply.createdAt, id: quotedReply.id } });
    await renderChat();
    if (panel === 'sheet') await openCommentsOf(3);
    else await act(() => openFragmentComments('m1', 'chat-1', false, {
      kind: panel, key: panel, range: { start: 0, end: 2 }, messageText: 'm1', focusInput: false,
      ...(panel === 'cluster' ? { clusterId: 'cluster-1', decisionId: null } : {}),
    } as Parameters<typeof openFragmentComments>[3]));
    await screen.findByText('корень');
    await fireEvent.press(screen.getByLabelText('Показать 2 ответа'));
    const quote = await screen.findByTestId('reply-quote');
    expect(quote).toBeDisabled();
    const before = rowKeys('comment-thread-list');
    const calls = mockedReplies.mock.calls.length;
    await fireEvent.press(quote);
    expect(rowKeys('comment-thread-list')).toEqual(before);
    expect(mockedReplies).toHaveBeenCalledTimes(calls);
    expect(screen.getByTestId(panel === 'sheet' ? 'comments-panel' : 'fragment-panel')).toBeTruthy();
    expect(screen.queryByTestId('jump-highlight')).toBeNull();
  });

  it('a message in the main list without a quote stays top-level', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');

    await fireEvent.changeText(commentField(), 'наверх');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'наверх',
        media: [],
        replyTo: [],
        commentThreadRootId: null,
      }),
    );
    expect(rowKeys()[0]).toMatch(/^local-/);
  });

  it('system back leaves selection first, then the comment thread, then closes the sheet', async () => {
    await openCommentThread();

    await startSelecting('r1');
    await screen.findByRole('button', { name: 'Ответить' });

    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ответить' })).toBeNull());
    expect(screen.getByText('Ответы')).toBeTruthy();

    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByText('Ответы')).toBeNull());
    expect(screen.getByTestId('comments-panel')).toBeTruthy();

    await fireEvent(screen.getByTestId('comments-panel'), 'requestClose');
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());
  });

  it('leaving the comment thread by the arrow keeps the typed text but drops the quote', async () => {
    await openCommentThread();

    await tapComment('r2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'черновик');

    await fireEvent.press(screen.getByLabelText('Назад к комментариям'));

    await waitFor(() => expect(screen.queryByText('Ответы')).toBeNull());
    expect(screen.queryByText('В ответ Олег')).toBeNull();
    expect(commentField().props.value).toBe('черновик');
  });

  it('a comment thread that failed to load offers a retry instead of an endless spinner', async () => {
    mockedReplies.mockRejectedValueOnce(new Error('offline'));

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');
    await fireEvent.press(screen.getByLabelText('Показать 2 ответа'));

    await fireEvent.press(await screen.findByText('Не удалось загрузить ответы. Повторить'));

    expect(await screen.findByText('второй ответ')).toBeTruthy();
  });

  it('a quote picked in the comment thread does not survive closing the sheet', async () => {
    await openCommentThread();

    await tapComment('r2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));
    expect(await screen.findByText('В ответ Олег')).toBeTruthy();

    // Тапом над шитом, прямо из треда: «назад» сначала вышел бы из треда.
    await fireEvent.press(screen.getByTestId('comments-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).toBeNull());
    await openCommentsOf(3);
    await screen.findByText('корень');

    expect(screen.queryByText('В ответ Олег')).toBeNull();
  });

  it('will not reply to two top-level comments at once — they are two comment threads', async () => {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');

    // «Выбрать» из меню, тап по другому — добавить к выбору.
    await startSelecting('root');
    await act(async () => {
      fireEvent.press(screen.getAllByTestId('message-row-other')[0]);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ответить' })).toBeDisabled());
  });
});

describe('two chat screens in the stack', () => {
  it('only the focused one draws the panel window — no twin under a closing panel', async () => {
    await renderChat();
    mockFocused = false;

    await fireEvent.press(buttons()[3]);

    expect(screen.queryByTestId('comments-panel')).toBeNull();
  });
});

describe('pinning a comment under a message', () => {
  async function menuOfFirstComment() {
    await screen.findByText('комментарий c1');
    await longPressMessage('c1');
    await screen.findByTestId('message-menu');
  }

  function as(userId: string) {
    mockedSession.mockReturnValue({
      session: { user: { id: userId } } as unknown as SupabaseSession,
      isAuthenticated: true,
      isLoading: false,
    });
  }

  beforeEach(() => {
    // Две реплики с комментариями: новая — Олега, старая — Марины.
    const items = [
      message('m2', 2, { authorId: 'user-2', commentsCount: 1 }),
      message('m1', 1, { authorId: 'user-1', commentsCount: 1 }),
    ];

    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });
    mockedListMessages.mockResolvedValue({ items, nextCursor: null });
    mockedTarget.mockImplementation(async (messageId) => ({
      state: 'live',
      message: items.find((item) => item.id === messageId)!,
      authorName: null,
      authorAvatarUrl: null,
    }));
  });

  it('the author of the message may pin under it in a dialog', async () => {
    as('user-1');
    await renderChat();
    await openCommentsOf(1);
    await menuOfFirstComment();

    expect(screen.getByRole('menuitem', { name: 'Закрепить' })).toBeTruthy();
  });

  it('the other side of the dialog may not pin under somebody else’s message', async () => {
    as('user-1');
    await renderChat();
    await openCommentsOf(0);
    await menuOfFirstComment();

    expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).toBeNull();
  });

  it('a visitor may not pin', async () => {
    await renderChat();
    await openCommentsOf(1);
    await menuOfFirstComment();

    expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).toBeNull();
  });

  it('in a channel’s posts the publisher may pin under any post', async () => {
    as('user-1');
    mockedGetChat.mockResolvedValue({ ...chat, kind: 'channel', participants: [author] });
    await renderChat();
    await openCommentsOf(0);
    await menuOfFirstComment();

    expect(screen.getByRole('menuitem', { name: 'Закрепить' })).toBeTruthy();
  });
});

describe('fragment quote over a comment', () => {
  const quoted = comment('cf', {
    text: 'про кусок',
    fragmentId: 'f1',
    fragmentQuote: { text: 'm1', start: 6, end: 8, lost: false },
  });

  beforeEach(() => {
    exitFragmentMode();
    useInAppAlert.setState({ alert: null });
    mockedListComments.mockResolvedValue({
      items: [quoted, comment('plain', { text: 'обычный' })],
      nextCursor: null,
    });
  });

  async function openSheet() {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('про кусок');
  }

  it('stands over a comment to a fragment and nowhere else', async () => {
    await openSheet();

    const plates = screen.getAllByTestId('comment-fragment-quote');

    expect(plates).toHaveLength(1);
    expect(within(plates[0]).getByText('m1')).toBeTruthy();
  });

  it('keeps the sheet open and does not locate the fragment when its quote is pressed', async () => {
    await openSheet();
    const plate = screen.getByTestId('comment-fragment-quote');
    expect(plate).toBeDisabled();
    await fireEvent.press(plate);
    expect(screen.getByTestId('comments-panel')).toBeTruthy();
    expect(screen.queryByTestId('quote-highlight')).toBeNull();
  });

  it('stands over the root in the comment thread window, not over the replies', async () => {
    mockedListComments.mockResolvedValue({
      items: [{ ...quoted, repliesCount: 1 }],
      nextCursor: null,
    });
    mockedReplies.mockResolvedValue({
      items: [comment('r1', { commentThreadRootId: 'cf', text: 'ответ в треде' })],
      nextCursor: null,
    });

    await openSheet();
    await fireEvent.press(screen.getByLabelText('Показать 1 ответ'));
    await screen.findByText('ответ в треде');

    expect(
      within(screen.getByTestId('comment-thread-root')).getByTestId('comment-fragment-quote'),
    ).toBeTruthy();
    // Корень дважды — в основном списке и в окне треда; у ответа плашки нет.
    expect(screen.getAllByTestId('comment-fragment-quote')).toHaveLength(2);
  });

  it('keeps the sheet open when the message is deleted', async () => {

    await openSheet();
    await fireEvent.press(screen.getByTestId('comment-fragment-quote'));

    expect(useInAppAlert.getState().alert).toBeNull();
    expect(screen.getByTestId('comments-panel')).toBeTruthy();
  });
});
