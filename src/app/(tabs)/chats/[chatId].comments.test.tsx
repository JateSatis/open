import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler, ScrollView, View } from 'react-native';

import ChatScreen from './[chatId]';

import type { ChatSummary, Message } from '@/api/chats';
import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import {
  getCommentTarget,
  listCommentsByIds,
  listThreadReplies,
  listThreadRoots,
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
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { island, original } from '@/test/islands';
import { renderWithQuery } from '@/test/renderWithQuery';

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

jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  Stack: { Screen: () => null },
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
const mockedListComments = listThreadRoots as jest.MockedFunction<typeof listThreadRoots>;
const mockedReplies = listThreadReplies as jest.MockedFunction<typeof listThreadReplies>;
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
  // Островок: кружок комментариев — у оригинала внутри, не у самого островка.
  island('m4', '2026-09-30T10:04:00Z', [
    original({
      id: 'o4',
      chatId: 'chat-1',
      commentsCount: 1,
      chat: { id: 'chat-1', name: 'Разговор', readUpTo: null, amMember: true },
    }),
  ]),
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
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    threadRootId: null,
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

/**
 * Строки списка комментариев по порядку экрана. Дерево тут не годится:
 * `FlashList` переиспользует ячейки, и порядок узлов не равен порядку строк.
 */
function rowKeys(list = 'comments-list'): string[] {
  return (mockListRows[list] ?? []).map((row) => row.key);
}

describe('comments button next to the bubble', () => {
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

describe('comments panel', () => {
  it('opens with only the comments inside, an honest empty state and a field — for a visitor too', async () => {
    await renderChat();

    // В самой переписке посетитель писать не может…
    expect(
      screen.getByText('Читать этот чат может кто угодно, писать — только участники.'),
    ).toBeTruthy();

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
    expect(mockedSend).toHaveBeenCalledWith('m1', {
      text: 'мой комментарий',
      media: [],
      replyTo: [],
      threadRootId: null,
    });

    await act(async () => refuse({ code: '42501', message: 'denied' }));

    expect(await screen.findByText('Не отправлено. Повторить')).toBeTruthy();
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

  it('lifts a copy of the message above the sheet and hides nothing else of the chat', async () => {
    // Строка и окно переписки на экране — с настоящей рамкой, а не нулевой.
    const measure = (callback: (...rect: number[]) => void) => callback(0, 300, 320, 60);
    const spies = [View, ScrollView].map((type) =>
      jest
        .spyOn(type.prototype as { measureInWindow: typeof measure }, 'measureInWindow')
        .mockImplementation(measure),
    );

    try {
      await renderChat();
      await openCommentsOf(3);
      await fireEvent(screen.getByTestId('comments-panel'), 'show');

      const copy = await screen.findByTestId('comments-lifted-message');

      expect(within(copy).getByText('текст m1')).toBeTruthy();
      // Копия неинтерактивна: кнопка комментариев в ней только показывает число.
      expect(within(copy).getByTestId('comments-button').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
      // Строка в переписке на месте — только прозрачная.
      expect(screen.getByTestId('message-row-m1')).toBeTruthy();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
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
  /** Тап по облачку комментария — его меню. */
  async function tapComment(id: string) {
    await act(async () => {
      fireEvent.press(screen.getByTestId(`message-row-${id}`));
    });
  }

  it('puts a reaction on a comment from its menu, and it lands in the viewers row at once', async () => {
    const mockedReact = setCommentReaction as jest.MockedFunction<typeof setCommentReaction>;
    mockedReact.mockResolvedValue({ emoji: '🔥', audience: 'visitor' });
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByTestId('reaction-option-🔥'));

    await waitFor(() => expect(mockedReact).toHaveBeenCalledWith('c1', '🔥'));
    expect(await screen.findByLabelText('Зрители: 🔥 1')).toBeTruthy();
  });

  it('replying to a top-level comment opens its thread: no quote, the message goes into it', async () => {
    mockedListComments.mockResolvedValue({ items: [comment('c1')], nextCursor: null });
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));

    // Окно треда — даже у комментария без ответов: в нём один корень.
    expect(await screen.findByText('Ответы')).toBeTruthy();
    expect(rowKeys('comments-thread-list')).toEqual(['c1']);
    expect(screen.queryByText('В ответ Олег')).toBeNull();

    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'согласен');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'согласен',
        media: [],
        replyTo: [],
        threadRootId: 'c1',
      }),
    );
    // Остаёмся в треде, свой ответ — в его конце.
    expect(screen.getByText('Ответы')).toBeTruthy();
    expect(rowKeys('comments-thread-list')[1]).toMatch(/^local-/);
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
            chat: { id: 'chat-2', name: 'Другой', readUpTo: null, amMember: false },
          }),
        ]),
        message('m1', 1),
      ],
      nextCursor: null,
    });
    mockedListComments.mockResolvedValue({
      items: [comment('c1', { messageId: 'o4', chatId: 'chat-2' })],
      nextCursor: null,
    });

    await renderChat();
    await openCommentsOf(0);
    await screen.findByText('комментарий c1');

    await tapComment('c1');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Переслать' }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/forward',
        params: { from: 'chat-1' },
      }),
    );
  });
});

describe('threads', () => {
  const root = comment('root', { repliesCount: 2, text: 'корень' });
  const replies = [
    comment('r1', {
      threadRootId: 'root',
      text: 'первый ответ',
      createdAt: '2026-09-30T11:01:00Z',
    }),
    comment('r2', {
      threadRootId: 'root',
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

  async function openThread() {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');
    await fireEvent.press(screen.getByLabelText('Показать 2 ответа'));
    await screen.findByText('второй ответ');
  }

  /** Тап по облачку комментария — его меню. */
  async function tapComment(id: string) {
    await act(async () => {
      fireEvent.press(screen.getAllByTestId(`message-row-${id}`).at(-1)!);
    });
  }

  it('puts the replies button only under a comment with replies and opens nothing in the list', async () => {
    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');

    expect(screen.getAllByTestId('thread-open')).toHaveLength(1);
    expect(screen.queryByText('первый ответ')).toBeNull();
    expect(rowKeys()).toEqual(['root', 'other']);
  });

  it('opens the thread window by the button: the root first on its own background, then the replies', async () => {
    await openThread();

    expect(screen.getByText('Ответы')).toBeTruthy();
    expect(screen.getByLabelText('Назад к комментариям')).toBeTruthy();
    expect(rowKeys('comments-thread-list')).toEqual(['root', 'r1', 'r2']);
    expect(screen.getByTestId('thread-root')).toBeTruthy();
    // Основной список не тронут — тред под корнем не раскрывается.
    expect(rowKeys()).toEqual(['root', 'other']);
    expect(mockedReplies).toHaveBeenCalledWith('root');
  });

  it('a message without a quote in the thread window goes into the thread, at its end', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await openThread();

    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'и я');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('m1', {
        text: 'и я',
        media: [],
        replyTo: [],
        threadRootId: 'root',
      }),
    );

    const keys = rowKeys('comments-thread-list');

    expect(keys.slice(0, 3)).toEqual(['root', 'r1', 'r2']);
    expect(keys[3]).toMatch(/^local-/);
    // Число на кнопке в основном списке считает и неотправленный.
    expect(screen.getByLabelText('Показать 3 ответа')).toBeTruthy();
  });

  it('a reply to a reply goes into the same thread with its quote', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await openThread();

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
        threadRootId: 'root',
      }),
    );
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
        threadRootId: null,
      }),
    );
    expect(rowKeys()[0]).toMatch(/^local-/);
  });

  it('system back leaves selection first, then the thread, then closes the sheet', async () => {
    const { fireGestureHandler, getByGestureTestId } = jest.requireActual(
      'react-native-gesture-handler/jest-utils',
    ) as typeof import('react-native-gesture-handler/jest-utils');

    await openThread();

    await act(async () => {
      fireGestureHandler(getByGestureTestId('message-long-press-r1'), [{ state: 4 }]);
    });
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

  it('leaving the thread by the arrow keeps the typed text but drops the quote', async () => {
    await openThread();

    await tapComment('r2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Ответить в треде'), 'черновик');

    await fireEvent.press(screen.getByLabelText('Назад к комментариям'));

    await waitFor(() => expect(screen.queryByText('Ответы')).toBeNull());
    expect(screen.queryByText('В ответ Олег')).toBeNull();
    expect(commentField().props.value).toBe('черновик');
  });

  it('will not reply to two top-level comments at once — they are two threads', async () => {
    const { fireGestureHandler, getByGestureTestId } = jest.requireActual(
      'react-native-gesture-handler/jest-utils',
    ) as typeof import('react-native-gesture-handler/jest-utils');

    await renderChat();
    await openCommentsOf(3);
    await screen.findByText('корень');

    // Долгое нажатие — выбор, тап по другому — добавить к выбору.
    await act(async () => {
      fireGestureHandler(getByGestureTestId('message-long-press-root'), [{ state: 4 }]);
    });
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
