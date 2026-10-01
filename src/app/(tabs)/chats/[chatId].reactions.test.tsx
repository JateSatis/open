import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import { getChat, listDeletedMessageIds, listMessages, subscribeToChat } from '@/api/chats';
import { listMessageReactions, setMessageReaction } from '@/api/reactions';
import { listPinnedMessages } from '@/api/pins';
import { confirm } from '@/components/ConfirmDialog';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { resetPendingReactions } from '@/features/interactions/pendingReactions';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { PRIMARY_REACTIONS } from '@/features/interactions/reactionSet';
import { renderWithQuery } from '@/test/renderWithQuery';
import { setLiftedMessage } from '@/features/chats/MessageRow/liftedStore';

// Шапку экран ставит через Stack.Screen — мок рисует и заголовок, и правую
// кнопку прямо в дереве: так видно «Выбрано: N» и «Отмена».
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
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode };
    }) => (
      <>
        {options?.headerTitle ? options.headerTitle() : null}
        {options?.headerRight ? options.headerRight() : null}
      </>
    ),
  },
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
  ImpactFeedbackStyle: { Medium: 'medium' },
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
const mockedSetReaction = setMessageReaction as jest.MockedFunction<typeof setMessageReaction>;
const mockedListReactions = listMessageReactions as jest.MockedFunction<
  typeof listMessageReactions
>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedConfirm = confirm as jest.MockedFunction<typeof confirm>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const AT = '2026-09-27T10:00:00Z';
const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };

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
    createdAt: `2026-09-27T10:0${minute}:00Z`,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
  };
}

let handlers: ChatChannelHandlers | null = null;

/** Тап по облачку — так открывается его меню. */
async function tapMessage(messageId: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`message-row-${messageId}`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Меню, оставленное открытым прошлым тестом, не прячет облачко в следующем.
  setLiftedMessage(null);
  handlers = null;
  resetOutbox();
  resetPendingReactions();
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
    items: [
      message('m3', 'как дела?', 'user-1', 3),
      message('m2', 'привет', 'user-2', 2),
      message('m1', 'эй', 'user-1', 1),
    ],
    nextCursor: null,
  });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedConfirm.mockResolvedValue(true);
  mockedSubscribe.mockImplementation((_chatId, given) => {
    handlers = given;
    return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: () => undefined }));
});

const visitor = { ...member, id: 'user-3', displayName: 'Пётр' };

function asVisitor() {
  mockedGetChat.mockResolvedValue(chatWith([other, visitor]));
}

async function pickerOptions(): Promise<string[]> {
  const picker = await screen.findByTestId('reaction-picker');

  return within(picker)
    .getAllByRole('button')
    .map((button) => button.props.testID as string);
}

async function react(emoji: string) {
  fireEvent.press(await screen.findByTestId(`reaction-option-${emoji}`));
  // Реакция ставится следующим кадром после закрытия меню, как и действие.
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}

describe('reactions in the message menu', () => {
  // Блок один для всех: и у участника, и у посетителя — ровно этот набор кнопок.
  const BLOCK = [
    'reaction-picker-expand',
    ...PRIMARY_REACTIONS.map((emoji) => `reaction-option-${emoji}`),
  ];

  it('shows a member the reaction block: expand button on the left, then the primary set', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');

    expect(await pickerOptions()).toEqual(BLOCK);
  });

  it('shows a visitor the very same block', async () => {
    asVisitor();

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');

    expect(await pickerOptions()).toEqual(BLOCK);
  });

  it('opens the whole set with the button on the left and hides the actions meanwhile', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');

    expect(screen.queryByTestId('reaction-option-🤯')).toBeNull();

    fireEvent.press(await screen.findByTestId('reaction-picker-expand'));

    expect(await screen.findByTestId('reaction-option-🤯')).toBeTruthy();
    expect(screen.getByTestId('message-menu').props.pointerEvents).toBe('none');
  });

  it('a tap sets the reaction, closes the menu and shows the chip at once', async () => {
    mockedSetReaction.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');
    await react('👍');

    expect(mockedSetReaction).toHaveBeenCalledWith('m2', '👍');
    expect(await screen.findByLabelText('👍 1')).toBeTruthy();
  });

  it('can react to an own sent message too', async () => {
    mockedSetReaction.mockResolvedValue({ emoji: '🔥', audience: 'member' });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('как дела?');
    await tapMessage('m3');
    await react('🔥');

    expect(mockedSetReaction).toHaveBeenCalledWith('m3', '🔥');
  });

  it('puts a visitor reaction into the viewers row, not among the members', async () => {
    asVisitor();
    mockedSetReaction.mockResolvedValue({ emoji: '🔥', audience: 'visitor' });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');
    await react('🔥');

    expect(await screen.findByTestId('visitor-reaction-🔥')).toBeTruthy();
    expect(screen.queryByTestId('reaction-chip-🔥')).toBeNull();
    expect(screen.getByLabelText('Зрители: 🔥 1')).toBeTruthy();
  });

  it('tapping my highlighted reaction in the block takes it off', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        {
          ...message('m2', 'привет', 'user-2', 2),
          reactions: {
            members: { '👍': 2 },
            visitors: {},
            mine: { emoji: '👍', audience: 'member' },
          },
        },
      ],
      nextCursor: null,
    });
    mockedSetReaction.mockResolvedValue(null);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');
    await react('👍');

    expect(mockedSetReaction).toHaveBeenCalledWith('m2', null);
    expect(await screen.findByLabelText('👍 1')).toBeTruthy();
  });

  it('rolls back and explains when the server refuses', async () => {
    mockedSetReaction.mockRejectedValue(new Error('boom'));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await tapMessage('m2');
    await react('😁');

    await waitFor(() => expect(screen.queryByTestId('reaction-chip-😁')).toBeNull());
    expect(useInAppAlert.getState().alert).toMatchObject({
      tone: 'error',
      text: 'Не удалось поставить реакцию',
    });
  });
});

describe('reactions in the bubble', () => {
  function withReactions() {
    mockedListMessages.mockResolvedValue({
      items: [
        {
          ...message('m2', 'привет', 'user-2', 2),
          reactions: { members: { '👍': 2 }, visitors: { '😁': 4 }, mine: null },
        },
      ],
      nextCursor: null,
    });
  }

  it('a member taps a member chip to add that reaction without the menu', async () => {
    withReactions();
    mockedSetReaction.mockResolvedValue({ emoji: '👍', audience: 'member' });

    await renderWithQuery(<ChatScreen />);
    fireEvent.press(await screen.findByTestId('reaction-chip-👍'));

    expect(mockedSetReaction).toHaveBeenCalledWith('m2', '👍');
    expect(await screen.findByLabelText('👍 3')).toBeTruthy();
    expect(screen.queryByTestId('message-menu')).toBeNull();
  });

  it('a member tap on the viewers row sets nothing', async () => {
    withReactions();

    await renderWithQuery(<ChatScreen />);
    fireEvent.press(await screen.findByTestId('visitor-reaction-😁'));

    expect(mockedSetReaction).not.toHaveBeenCalled();
  });

  it('a visitor taps the viewers row, and member chips do not react', async () => {
    withReactions();
    asVisitor();
    mockedSetReaction.mockResolvedValue({ emoji: '😁', audience: 'visitor' });

    await renderWithQuery(<ChatScreen />);
    // Чип участников для посетителя не кнопка: тап уходит облачку — его меню.
    fireEvent.press(await screen.findByTestId('reaction-chip-👍'));

    expect(mockedSetReaction).not.toHaveBeenCalled();
    expect(await screen.findByTestId('message-menu')).toBeTruthy();

    fireEvent.press(screen.getByTestId('message-menu-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());

    fireEvent.press(screen.getByTestId('visitor-reaction-😁'));

    expect(mockedSetReaction).toHaveBeenCalledWith('m2', '😁');
    expect(await screen.findByLabelText('Зрители: 😁 5')).toBeTruthy();
  });

  it('updates the counters when someone else reacts, without reloading the chat', async () => {
    withReactions();
    mockedListReactions.mockResolvedValue([
      {
        id: 'm2',
        reactions: { members: { '👍': 3, '🔥': 1 }, visitors: { '😁': 4 }, mine: null },
      },
    ]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('👍 2');

    await act(async () => handlers!.onReactionsChanged('m2'));

    expect(await screen.findByLabelText('👍 3')).toBeTruthy();
    expect(screen.getByLabelText('🔥 1')).toBeTruthy();
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
  });
});
