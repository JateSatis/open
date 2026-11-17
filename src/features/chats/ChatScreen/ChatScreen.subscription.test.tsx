jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatRoute as ChatScreen } from '@/navigation/screens/ChatRoute';

import type { ChatSummary } from '@/api/chats';
import { getChat, listMessages, markChatRead, subscribeToChat } from '@/api/chats';
import { acceptInvite, declineInvite, getMyInvite } from '@/api/invites';
import { listMessageViews } from '@/api/messageViews';
import { getProfile } from '@/api/profile';
import {
  getMyChatSubscription,
  markChatSubscriptionRead,
  setChatNotifications,
  subscribeToChat as subscribeToChatTarget,
  unsubscribeFromChat,
  type Subscription,
} from '@/api/subscriptions';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

// Шапку экран ставит через ScreenOptions — мок рисует и название, и правую
// часть («⋮», звонок) прямо в дереве.
jest.mock('@/api/messageViews');
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRouteParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  ScreenOptions: ({
      options,
    }: {
      options?: {
        headerTitle?: () => React.ReactNode;
        headerRight?: () => React.ReactNode;
      };
    }) => (
      <>
        {options?.headerTitle ? options.headerTitle() : null}
        {options?.headerRight ? options.headerRight() : null}
      </>
    ),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/streams');

jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(),
  markChatRead: jest.fn(),
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
  getPinnedComment: jest.fn(() => Promise.resolve(null)),
  pinComment: jest.fn(() => Promise.resolve()),
  unpinComment: jest.fn(() => Promise.resolve()),
  listComments: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getCommentTarget: jest.fn(() => Promise.resolve({ state: 'missing' })),
  subscribeToComments: jest.fn(() => () => undefined),
}));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(() => Promise.resolve([])),
  pinMessage: jest.fn(),
  unpinMessage: jest.fn(),
}));

jest.mock('@/api/invites', () => ({
  getMyInvite: jest.fn(),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));

// Этот экран не тестирует ни грид выбора медиа, ни просмотрщик — оба тянут
// за собой нативные модули (expo-video, expo-camera, expo-media-library…),
// которых в тестовом окружении нет и не должно быть. Мок обрывает эту
// цепочку на границе фичи, как и мок `@/api/chats` выше.
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
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
const mockedMarkRead = markChatRead as jest.MockedFunction<typeof markChatRead>;
const mockedGetProfile = getProfile as jest.MockedFunction<typeof getProfile>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedMyInvite = getMyInvite as jest.MockedFunction<typeof getMyInvite>;
const mockedAccept = acceptInvite as jest.MockedFunction<typeof acceptInvite>;
const mockedDecline = declineInvite as jest.MockedFunction<typeof declineInvite>;
const { listMessagesSince } = jest.requireMock('@/api/chats') as {
  listMessagesSince: jest.Mock;
};

const READ_AT = '2026-09-16T09:00:00Z';

const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: READ_AT };

function chatWith(participants: ChatSummary['participants']): ChatSummary {
  return {
    id: 'chat-1',
    kind: 'direct',
    ownerId: null,
    description: null,
    avatarUrl: null,
    title: 'Разговор',
    participants,
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
}

const anna = { id: 'user-2', displayName: 'Аня', avatarUrl: null, lastReadAt: READ_AT };
const petr = { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT };

const subscription: Subscription = {
  channelId: null,
  chatId: 'chat-1',
  inChats: true,
  notify: true,
  unreadPosts: 0,
  unreadPops: 0,
  inChatsAt: null,
};

/** Подписка и счётчик живут в «базе» теста и меняются вместе с действиями. */
let stored: Subscription | null = null;
let subscribers = 0;

function theirDialogue(): ChatSummary {
  return { ...chatWith([anna, petr]), title: null, subscribersCount: subscribers };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  stored = null;
  subscribers = 0;
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  listMessagesSince.mockResolvedValue([]);
  (listMessageViews as jest.Mock).mockResolvedValue([]);
  mockedMarkRead.mockResolvedValue(undefined);
  mockedListMessages.mockResolvedValue({ items: [], nextCursor: null });
  mockedGetChat.mockImplementation(async () => theirDialogue());
  mockedMyInvite.mockResolvedValue(null);
  mockedAccept.mockResolvedValue(undefined);
  mockedDecline.mockResolvedValue(undefined);
  mockedGetProfile.mockResolvedValue({
    id: 'user-3',
    username: 'petr',
    displayName: 'Пётр',
    avatarUrl: null,
    bio: null,
    status: null,
  });
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
  jest.mocked(getMyChatSubscription).mockImplementation(async () => stored);
  jest.mocked(subscribeToChatTarget).mockImplementation(async () => {
    stored = subscription;
    subscribers = 1;
  });
  jest.mocked(unsubscribeFromChat).mockImplementation(async () => {
    stored = null;
    subscribers = 0;
  });
  jest.mocked(setChatNotifications).mockImplementation(async (_id, enabled) => {
    stored = stored ? { ...stored, notify: enabled } : stored;
  });
});

describe("ChatScreen: someone else's dialogue", () => {
  it('names it after both people with two avatars and shows the subscriber count', async () => {
    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Аня и Пётр')).toBeTruthy();
    expect(screen.getByTestId('chat-header-avatar-pair')).toBeTruthy();
    expect(screen.getByText('0 подписчиков')).toBeTruthy();
    // Без подписки «⋮» нет, звонка тоже.
    expect(screen.queryByLabelText('Меню чата')).toBeNull();
    expect(screen.queryByLabelText('Позвонить')).toBeNull();
  });

  it('subscribes from the bottom: the bar goes, the count grows, «⋮» appears', async () => {
    await renderWithQuery(<ChatScreen />);

    fireEvent.press(await screen.findByTestId('chat-subscribe-button'));

    await waitFor(() => expect(screen.queryByTestId('chat-subscribe-bar')).toBeNull());
    expect(subscribeToChatTarget).toHaveBeenCalledWith('chat-1');
    expect(await screen.findByText('1 подписчик')).toBeTruthy();
    // Писать подписка не даёт: поля ввода нет.
    expect(screen.queryByPlaceholderText('Сообщение')).toBeNull();

    fireEvent.press(await screen.findByLabelText('Меню чата'));

    expect(await screen.findByText('Выключить уведомления')).toBeTruthy();
    expect(screen.getByText('Отписаться')).toBeTruthy();
    expect(screen.queryByText('Не отображать в чатах')).toBeNull();
  });

  it('does not mark a subscription or member read on load alone', async () => {
    stored = subscription;
    subscribers = 1;
    mockedListMessages.mockResolvedValue({
      items: [
        {
          id: 'm1',
          chatId: 'chat-1',
          authorId: 'user-3',
          kind: 'text',
          text: 'Аня, привет',
          seq: Date.parse('2026-09-16T10:00:00Z'),
          createdAt: '2026-09-16T10:00:00Z',
          editedAt: null,
          edited: false,
          editMark: null,
          attachments: [],
          replies: [],
          forward: null,
          reactions: { members: {}, visitors: {}, mine: null },
          commentsCount: 0,
          viewsCount: 0,
          readAt: null,
        },
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Аня, привет')).toBeTruthy();
    expect(markChatSubscriptionRead).not.toHaveBeenCalled();
    expect(mockedMarkRead).not.toHaveBeenCalled();
  });

  it('unsubscribes from «⋮»: «Подписаться» is back and the count drops', async () => {
    stored = subscription;
    subscribers = 1;

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('1 подписчик')).toBeTruthy();
    fireEvent.press(await screen.findByLabelText('Меню чата'));
    fireEvent.press(await screen.findByText('Отписаться'));

    expect(await screen.findByTestId('chat-subscribe-button')).toBeTruthy();
    expect(unsubscribeFromChat).toHaveBeenCalledWith('chat-1');
    expect(await screen.findByText('0 подписчиков')).toBeTruthy();
  });

  it('still offers «Подписаться» when the subscription could not be read', async () => {
    jest.mocked(getMyChatSubscription).mockRejectedValue(new Error('offline'));

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByTestId('chat-subscribe-button')).toBeTruthy();
  });

  it('keeps the invite answer, not «Подписаться», for a pending invitee', async () => {
    mockedGetChat.mockImplementation(async () => ({
      ...chatWith([anna]),
      kind: 'group',
      title: 'Группа',
      waiting: [{ id: 'user-1', displayName: 'Я', avatarUrl: null }],
    }));
    mockedMyInvite.mockResolvedValue({ status: 'pending', inviter: anna });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Отклонить')).toBeTruthy();
    expect(screen.queryByTestId('chat-subscribe-button')).toBeNull();
  });
});

describe('ChatScreen: my own dialogue', () => {
  it('keeps the counterpart name and gives a member «Подписчики» next to the call', async () => {
    mockedGetChat.mockImplementation(async () => ({
      ...chatWith([member, petr]),
      title: null,
      subscribersCount: 3,
    }));

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Пётр')).toBeTruthy();
    expect(screen.queryByTestId('chat-header-avatar-pair')).toBeNull();
    expect(screen.getByText('3 подписчика')).toBeTruthy();
    expect(screen.getByLabelText('Позвонить')).toBeTruthy();
    expect(screen.queryByTestId('chat-subscribe-button')).toBeNull();

    fireEvent.press(screen.getByLabelText('Меню чата'));
    fireEvent.press(await screen.findByText('Подписчики'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        name: 'ChatSubscribers',
        params: { chatId: 'chat-1' },
      }),
    );
    expect(getMyChatSubscription).not.toHaveBeenCalled();
  });
});
