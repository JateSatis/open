import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import ChatScreen from './[chatId]';

import type { ChatSummary, Message } from '@/api/chats';
import {
  getChat,
  listDeletedMessageIds,
  listMessages,
  subscribeToChat,
  subscribeToChatSignals,
} from '@/api/chats';
import type { ChatTopicListener } from '@/api/chatTopics';
import { listPinnedMessages } from '@/api/pins';
import { listMessageReactions, setMessageReaction } from '@/api/reactions';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts, useComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { resetPendingReactions } from '@/features/interactions/pendingReactions';
import { island, original } from '@/test/islands';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('expo-router', () => ({
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
  subscribeToChat: jest.fn(),
  subscribeToChatSignals: jest.fn(),
  getChatReadUpTo: jest.fn(() => Promise.resolve(null)),
  deleteMessages: jest.fn(),
  removeForwardItems: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
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
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedSignals = subscribeToChatSignals as jest.MockedFunction<typeof subscribeToChatSignals>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSetReaction = setMessageReaction as jest.MockedFunction<typeof setMessageReaction>;
const mockedReactions = listMessageReactions as jest.MockedFunction<typeof listMessageReactions>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const AT = '2026-09-30T10:00:00Z';
const JS = { id: 'chat-js', name: 'Джиган и Самойлова', readUpTo: null, amMember: false };
const HATE = { id: 'chat-hate', name: 'Хейтеры Джигана', readUpTo: null, amMember: true };

// Пример из задачи: Вася (я) переслал в «Васю и Свету» два облачка островка
// «Хейтеров» — оригиналы из «Джигана и Самойловой» — и одно обычное сообщение
// «Хейтеров». Четвёртое облачко — оригинал, который уже удалили.
const o1 = original({
  id: 'o1',
  chatId: 'chat-js',
  text: 'Самойлова, ты дура!',
  authorId: 'user-9',
  authorName: 'Джиган',
  createdAt: '2026-09-01T10:00:00Z',
  reactions: { members: { '🔥': 17 }, visitors: {}, mine: null },
  commentsCount: 146,
  chat: JS,
});
const o2 = original({
  id: 'o2',
  chatId: 'chat-js',
  text: 'Сам ты дурак, Джиган!',
  authorId: 'user-8',
  authorName: 'Самойлова',
  createdAt: '2026-09-01T10:01:00Z',
  chat: JS,
});
const o3 = original({
  id: 'o3',
  chatId: 'chat-hate',
  text: 'Ну Джиган и конченый придурок!',
  authorId: 'user-7',
  authorName: 'Второй админ',
  createdAt: '2026-09-20T10:00:00Z',
  chat: HATE,
});

function chat(): ChatSummary {
  return {
    id: 'chat-1',
    kind: 'group',
    title: 'Вася и Света',
    participants: [
      { id: 'user-1', displayName: 'Вася', avatarUrl: null, lastReadAt: AT },
      { id: 'user-2', displayName: 'Света', avatarUrl: null, lastReadAt: AT },
    ],
    waiting: [],
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageAuthorId: null,
    hasUnread: false,
  };
}

function text(id: string, body: string, createdAt: string): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: body,
    createdAt,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
  };
}

const ISLAND = island('isl', AT, [o1, o2, o3, null], {
  authorId: 'user-1',
  sourceChat: { id: 'chat-hate', name: 'Хейтеры Джигана' },
});

async function longPress(rowKey: string) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`message-long-press-${rowKey}`), [
      { state: State.BEGAN, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
      { state: State.ACTIVE, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
      { state: State.END, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
    ]);
  });
}

async function choose(label: string) {
  fireEvent.press(await screen.findByRole('menuitem', { name: label }));
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}

/** Облачко, где стоит текст. */
function bubbleWith(body: string) {
  const bubble = screen
    .getAllByTestId('message-bubble')
    .find((node) => within(node).queryByText(body) !== null);

  if (!bubble) throw new Error(`Нет облачка с текстом «${body}»`);

  return bubble;
}

/** Кружок выбора строки, где стоит текст. */
function markOf(body: string) {
  const mark = screen
    .getAllByRole('checkbox')
    .find((node) => within(node).queryByText(body) !== null);

  if (!mark) throw new Error(`Нет строки с текстом «${body}»`);

  return mark;
}

const listeners = new Map<string, ChatTopicListener>();

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  resetComposerDrafts();
  resetPendingReactions();
  resetConnectionState();
  reportRealtimeJoined();
  listeners.clear();
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedGetChat.mockResolvedValue(chat());
  mockedListMessages.mockResolvedValue({
    items: [text('m1', 'обычное Светы', '2026-09-30T10:05:00Z'), ISLAND],
    nextCursor: null,
  });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
  mockedSignals.mockImplementation((chatId, listener) => {
    listeners.set(chatId, listener);
    return () => listeners.delete(chatId);
  });
});

async function renderChat() {
  await renderWithQuery(<ChatScreen />);
  await screen.findByText('Самойлова, ты дура!');
}

describe('forward island', () => {
  it('names the chat it was forwarded from on a plate above the bubbles', async () => {
    await renderChat();

    expect(within(screen.getByTestId('island-header')).getByText('↪ Хейтеры Джигана')).toBeTruthy();
    // Рамка — по куску на строку: плашка и четыре облачка.
    expect(screen.getAllByTestId('island-border')).toHaveLength(5);
  });

  it('opens the chat it was forwarded from on a tap on the plate', async () => {
    await renderChat();

    fireEvent.press(screen.getByLabelText('Переслано из чата «Хейтеры Джигана»'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: { chatId: 'chat-hate' },
    });
  });

  it('adds «<author> из <chat>» only to bubbles from another chat than the plate', async () => {
    await renderChat();

    // 6b: оригиналы из «Джигана и Самойловой».
    expect(within(bubbleWith('Самойлова, ты дура!')).getByTestId('message-source-chat')).toHaveTextContent(
      'Джиган и Самойлова',
    );
    expect(within(bubbleWith('Сам ты дурак, Джиган!')).getByText('Самойлова')).toBeTruthy();
    // 6a: сообщение из «Хейтеров» — только автор.
    expect(
      within(bubbleWith('Ну Джиган и конченый придурок!')).queryByTestId('message-source-chat'),
    ).toBeNull();
    expect(within(bubbleWith('Ну Джиган и конченый придурок!')).getByText('Второй админ')).toBeTruthy();
  });

  it('shows the original’s own reactions and comments, not zeros', async () => {
    await renderChat();

    expect(within(bubbleWith('Самойлова, ты дура!')).getByLabelText('🔥 17')).toBeTruthy();
    expect(screen.getByLabelText('Комментарии: 146 комментариев')).toBeTruthy();
  });

  it('opens the original’s chat at the message on a tap on «из <chat>»', async () => {
    await renderChat();

    fireEvent.press(within(bubbleWith('Самойлова, ты дура!')).getByTestId('message-source-chat'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/[chatId]',
        params: {
          chatId: 'chat-js',
          jumpTo: 'o1',
          jumpAt: '2026-09-01T10:00:00Z',
          jumpKey: expect.any(String),
        },
      }),
    );
  });

  it('keeps a stub in place of a deleted original', async () => {
    await renderChat();

    expect(within(screen.getByTestId('deleted-original')).getByText('Сообщение удалено')).toBeTruthy();
  });

  it('puts a reaction from the island on the original, in the row of the original’s chat', async () => {
    mockedSetReaction.mockReturnValue(new Promise(() => undefined));

    await renderChat();
    await longPress('isl/o1');
    fireEvent.press(await screen.findByTestId('reaction-option-👍'));

    // Я не участник «Джигана и Самойловой» — ряд посетителей, хоть в этом чате
    // я участник.
    await waitFor(() => expect(mockedSetReaction).toHaveBeenCalledWith('o1', '👍'));
    expect(
      await within(bubbleWith('Самойлова, ты дура!')).findByLabelText('Зрители: 👍 1'),
    ).toBeTruthy();
  });

  it('listens to the chats of the originals and takes their reactions from there', async () => {
    mockedReactions.mockResolvedValue([
      { id: 'o1', reactions: { members: { '🔥': 18 }, visitors: {}, mine: null } },
    ]);

    await renderChat();

    // Свой чат слушает свой канал — источники только чужие.
    expect([...listeners.keys()].sort()).toEqual(['chat-hate', 'chat-js']);

    await act(async () => listeners.get('chat-js')?.onReactionsChanged?.('o1'));

    expect(
      await within(bubbleWith('Самойлова, ты дура!')).findByLabelText('🔥 18', {}, { timeout: 2000 }),
    ).toBeTruthy();
  });

  it('turns an original deleted in its chat into a stub without leaving the screen', async () => {
    mockedTombstones.mockResolvedValue(['o2']);

    await renderChat();
    await act(async () => listeners.get('chat-js')?.onMessagesDeleted?.(['o2']));

    await waitFor(() => expect(screen.queryByText('Сам ты дурак, Джиган!')).toBeNull());
    expect(screen.getAllByTestId('deleted-original')).toHaveLength(2);
  });

  it('offers no edit and no delete of the original, but lets the forwarder take it out', async () => {
    await renderChat();
    await longPress('isl/o3');

    await screen.findByTestId('message-menu');
    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Удалить' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Перейти к оригиналу' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Убрать из пересылки' })).toBeTruthy();
  });

  it('forwards a mixed selection in the order it stands on screen, from this chat', async () => {
    await renderChat();
    await longPress('isl/o2');
    await choose('Выбрать');

    // Отмечаю вразнобой: сначала обычное снизу, потом верхнее облачко островка.
    fireEvent.press(markOf('обычное Светы'));
    fireEvent.press(markOf('Самойлова, ты дура!'));
    fireEvent.press(await screen.findByRole('button', { name: 'Переслать' }));

    const pick = useComposerDrafts.getState().forwardPick;

    expect(pick?.sourceChat).toEqual({ id: 'chat-1', name: 'Вася и Света' });
    expect(pick?.items.map((item) => item.original.id)).toEqual(['o1', 'o2', 'm1']);
    // Облачко островка пересылается своим оригиналом — со своим автором и чатом.
    expect(pick?.items[0].original).toMatchObject({ authorName: 'Джиган', chat: JS });
  });
});
