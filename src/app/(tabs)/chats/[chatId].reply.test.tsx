import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import ChatScreen from './[chatId]';

import type { ChatSummary, Message, QuotedMessage } from '@/api/chats';
import {
  getChat,
  listDeletedMessageIds,
  listMessages,
  sendMessage,
  subscribeToChat,
} from '@/api/chats';
import { listPinnedMessages } from '@/api/pins';
import { useSession } from '@/features/auth/useSession';
import { readChatDraft, resetComposerDrafts, useComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/streams');

jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  markChatRead: jest.fn(() => Promise.resolve()),
  sendMessage: jest.fn(),
  forwardMessages: jest.fn(),
  subscribeToChat: jest.fn(),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  editMessage: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));
// Панель комментариев в этих тестах не открывается — её сеть здесь не нужна.
jest.mock('@/api/comments', () => ({
  listComments: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getCommentTarget: jest.fn(() => Promise.resolve({ state: 'missing' })),
  subscribeToComments: jest.fn(() => () => undefined),
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
jest.mock('@/components/ConfirmDialog', () => ({ confirm: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  HoldToRecordRow: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSend = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const AT = '2026-09-29T10:00:00Z';
const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };
const stranger = { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: AT };

function chatWith(participants: ChatSummary['participants']): ChatSummary {
  return {
    id: 'chat-1',
    kind: 'direct',
    title: 'Разговор',
    participants,
    waiting: [],
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageAuthorId: null,
    hasUnread: false,
  };
}

function message(id: string, text: string, authorId: string, minute = 0): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text,
    createdAt: `2026-09-29T10:0${minute}:00Z`,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
  };
}

/** Тап по облачку — так открывается его меню. */
async function tapMessage(messageId: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`message-row-${messageId}`));
  });
}

async function choose(label: string) {
  fireEvent.press(await screen.findByRole('menuitem', { name: label }));
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  useInAppAlert.setState({ alert: null });
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedGetChat.mockResolvedValue(chatWith([member, other]));
  mockedListMessages.mockResolvedValue({
    items: [message('m2', 'привет', 'user-2', 2), message('m1', 'эй', 'user-1', 1)],
    nextCursor: null,
  });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
});

// Фокус в поле ставится следующим кадром после закрытия меню — кадр должен
// отыграть внутри своего теста, а не посреди отрисовки следующего.
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('replying', () => {
  it('puts the message into a plate above the field and sends the text as a reply', async () => {
    mockedSend.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m2');
    await choose('Ответить');

    const plate = await screen.findByTestId('composer-plate');

    expect(within(plate).getByText('В ответ Марина')).toBeTruthy();
    expect(within(plate).getByText('привет')).toBeTruthy();

    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Сообщение'), 'согласна');
    await user.press(screen.getByLabelText('Отправить'));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('chat-1', {
        text: 'согласна',
        media: undefined,
        replyTo: ['m2'],
      }),
    );
    // Ответ уже на экране — с цитатой; плашка ушла вместе с текстом.
    await waitFor(() => expect(screen.queryByTestId('composer-plate')).toBeNull());
    expect(await screen.findByTestId('reply-quote')).toBeTruthy();
  });

  it('drops the reply with the cross but keeps what was typed', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await userEvent.setup().type(screen.getByLabelText('Сообщение'), 'черновик');
    await tapMessage('m2');
    await choose('Ответить');
    fireEvent.press(await screen.findByRole('button', { name: 'Отменить ответ' }));

    await waitFor(() => expect(screen.queryByTestId('composer-plate')).toBeNull());
    expect(screen.getByLabelText('Сообщение').props.value).toBe('черновик');
  });

  it('keeps the reply draft for the chat after leaving it', async () => {
    const view = await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m2');
    await choose('Ответить');
    await userEvent.setup().type(screen.getByLabelText('Сообщение'), 'допишу потом');
    await view.unmount();

    expect(readChatDraft('chat-1')).toMatchObject({
      text: 'допишу потом',
      mode: { type: 'reply', quotes: [expect.objectContaining({ messageId: 'm2' })] },
    });
  });

  it('replies to several selected messages at once', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m2');
    await choose('Выбрать');
    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    fireEvent.press(await screen.findByRole('button', { name: 'Ответить' }));

    const plate = await screen.findByTestId('composer-plate');

    expect(within(plate).getByText('В ответ на 2 сообщения')).toBeTruthy();
    // Порядок — как в переписке, а не как отмечали.
    expect(
      readChatDraft('chat-1').mode?.type === 'reply' &&
        readChatDraft('chat-1').mode,
    ).toMatchObject({ quotes: [{ messageId: 'm1' }, { messageId: 'm2' }] });
  });

  it('offers the swipe to a member only, and a swipe past the threshold starts a reply', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByTestId('composer-plate')).toBeNull();

    await act(async () => {
      fireGestureHandler(getByGestureTestId('message-swipe-reply-m2'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -40 },
        { state: State.ACTIVE, translationX: -120 },
        { state: State.END, translationX: -120 },
      ]);
    });

    expect(await screen.findByText('В ответ Марина')).toBeTruthy();
  });

  it('gives a visitor neither the menu item nor the swipe, and a disabled button in selection', async () => {
    mockedGetChat.mockResolvedValue(chatWith([other, stranger]));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await act(async () => {
      fireGestureHandler(getByGestureTestId('message-swipe-reply-m2'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -120 },
        { state: State.END, translationX: -120 },
      ]);
    });
    // У посетителя нет поля ввода, поэтому смотрим в сам черновик.
    expect(readChatDraft('chat-1').mode).toBeNull();

    await tapMessage('m2');
    await screen.findByTestId('message-menu');
    expect(screen.queryByRole('menuitem', { name: 'Ответить' })).toBeNull();

    await choose('Выбрать');

    expect(screen.getByRole('button', { name: 'Ответить' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Переслать' })).toBeEnabled();
  });
});

describe('quotes in bubbles', () => {
  const liveQuote: QuotedMessage = {
    messageId: 'm1',
    state: 'live',
    authorId: 'user-1',
    authorName: 'Я',
    createdAt: '2026-09-29T10:01:00Z',
    editedAt: null,
    preview: {
      kind: 'text',
      text: 'эй',
      thumbnailUrl: null,
      mediaCount: 0,
      firstMediaIsVideo: false,
      durationMs: null,
    },
  };

  it('shows the quote, and a deleted original as «Сообщение удалено»', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        { ...message('r2', 'про удалённое', 'user-2', 4), replies: [{ messageId: 'x', state: 'deleted' }] },
        { ...message('r1', 'про эй', 'user-2', 3), replies: [liveQuote] },
        message('m1', 'эй', 'user-1', 1),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('про эй');

    const [deleted, live] = screen.getAllByTestId('reply-quote');

    expect(within(deleted).getByText('Сообщение удалено')).toBeTruthy();
    expect(deleted).toBeDisabled();
    expect(within(live).getByText('Я')).toBeTruthy();
    expect(within(live).getByText('эй')).toBeTruthy();
  });

  it('lists every quote of a reply to several, oldest on top, and each leads to its own original', async () => {
    const second: QuotedMessage = {
      ...liveQuote,
      messageId: 'm2',
      authorId: 'user-2',
      authorName: 'Марина',
      createdAt: '2026-09-29T10:02:00Z',
      preview: { ...liveQuote.preview, text: 'привет' },
    };
    mockedListMessages.mockResolvedValue({
      items: [
        { ...message('r1', 'на оба', 'user-2', 3), replies: [liveQuote, second] },
        message('m2', 'привет', 'user-2', 2),
        message('m1', 'эй', 'user-1', 1),
      ],
      nextCursor: null,
    });
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('на оба');

    const quotes = screen.getAllByTestId('reply-quote');

    expect(quotes).toHaveLength(2);
    expect(within(quotes[0]).getByText('эй')).toBeTruthy();
    expect(within(quotes[1]).getByText('привет')).toBeTruthy();

    // Строки списка — новыми вперёд: r1, m2, m1.
    fireEvent.press(quotes[1]);
    await waitFor(() => expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 })));

    fireEvent.press(quotes[0]);
    await waitFor(() => expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 2 })));

    scrollToIndex.mockRestore();
  });
});

describe('forwarding', () => {
  it('remembers what to forward and opens the chat picker', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m2');
    await choose('Переслать');

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chats/forward', params: { from: 'chat-1' } });
    // Пересылается оригинал целиком — с автором и чатом, откуда пересылают.
    expect(useComposerDrafts.getState().forwardPick).toEqual({
      sourceChat: { id: 'chat-1', name: expect.any(String) },
      items: [
        {
          original: expect.objectContaining({
            id: 'm2',
            authorName: 'Марина',
            chat: expect.objectContaining({ id: 'chat-1' }),
          }),
        },
      ],
    });
  });
});
