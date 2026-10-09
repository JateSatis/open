import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { ChannelScreen } from '.';

import { getChannel } from '@/api/channels';
import type { ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, subscribeToChat } from '@/api/chats';
import { listMessageViews } from '@/api/messageViews';
import ChatScreen from '@/app/(tabs)/chats/[chatId]';
import { useSession } from '@/features/auth/useSession';
import { readChatDraft, resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockRedirect = jest.fn();

jest.mock('@/api/messageViews');
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
// Шапка ставится через Stack.Screen — мок рисует её заголовок и правую часть в дереве.
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => ({ chatId: 'posts-1' }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
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
jest.mock('@/api/channels', () => ({ getChannel: jest.fn() }));
jest.mock('@/api/pops', () => ({
  POPS_PAGE_SIZE: 30,
  listPops: jest.fn(() => Promise.resolve([])),
  canPublishInChannel: jest.fn(() => Promise.resolve(false)),
}));

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

jest.mock('@/api/comments', () => ({
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
  getMyInvite: jest.fn(() => Promise.resolve(null)),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));

jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
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

const mockedGetChannel = getChannel as jest.MockedFunction<typeof getChannel>;
const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const OWNER = 'owner-1';
const SENT_AT = '2026-10-07T10:00:00Z';

const channel = {
  id: 'channel-1',
  title: 'Мой канал',
  description: null,
  username: 'my_channel',
  avatarUrl: null,
  ownerId: OWNER,
  postsChatId: 'posts-1',
};

const postsChat: ChatSummary = {
  id: 'posts-1',
  kind: 'channel',
  title: null,
  channel: { id: 'channel-1', title: 'Мой канал', username: 'my_channel', avatarUrl: null },
  participants: [{ id: OWNER, displayName: 'Максим', avatarUrl: null, lastReadAt: SENT_AT }],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  hasUnread: false,
};

const post: Message = {
  id: 'p1',
  chatId: 'posts-1',
  authorId: OWNER,
  kind: 'text',
  text: 'первый пост',
  createdAt: SENT_AT,
  editedAt: null,
  attachments: [],
  replies: [],
  forward: null,
  reactions: { members: {}, visitors: {}, mine: null },
  commentsCount: 0,
  viewsCount: 3,
  readAt: SENT_AT,
};

function signIn(userId: string) {
  mockedSession.mockReturnValue({
    session: { user: { id: userId } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
}

async function renderChannel() {
  await renderWithQuery(<ChannelScreen channelId="channel-1" />);
  await screen.findByText('первый пост');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  signIn(OWNER);
  (listMessageViews as jest.Mock).mockResolvedValue([]);
  mockedGetChannel.mockResolvedValue(channel);
  mockedGetChat.mockResolvedValue(postsChat);
  mockedListMessages.mockResolvedValue({ items: [post], nextCursor: null });
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
});

describe('ChannelScreen', () => {
  it('shows the channel in the header without a call button, «Посты» selected', async () => {
    await renderChannel();

    expect(screen.getAllByText('Мой канал').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Позвонить')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Посты' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('signs posts with the channel, not with the person, and shows no delivery checks', async () => {
    await renderChannel();

    const bubble = screen.getByTestId('message-bubble');

    expect(within(bubble).getByText('Мой канал')).toBeTruthy();
    expect(within(bubble).queryByText('Максим')).toBeNull();
    expect(screen.queryByLabelText('Профиль: Максим')).toBeNull();
    expect(within(bubble).queryByTestId(/^message-status-/)).toBeNull();
    expect(within(bubble).getByLabelText('Просмотры: 3')).toBeTruthy();
  });

  it('gives the owner a composer and a reply only from the menu, never by swipe', async () => {
    await renderChannel();

    expect(screen.getByPlaceholderText('Сообщение')).toBeTruthy();

    await act(async () => {
      fireGestureHandler(getByGestureTestId('message-swipe-reply-p1'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -120 },
        { state: State.END, translationX: -120 },
      ]);
    });
    expect(readChatDraft('posts-1').mode).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('message-row-p1'));
    });
    fireEvent.press(await screen.findByRole('menuitem', { name: 'Ответить' }));
    await waitFor(() => expect(readChatDraft('posts-1').mode?.type).toBe('reply'));
  });

  it('shows a stranger no composer at all, but keeps comments', async () => {
    signIn('stranger-1');
    await renderChannel();

    expect(screen.queryByPlaceholderText('Сообщение')).toBeNull();
    expect(screen.queryByText(/писать — только участники/)).toBeNull();
    expect(screen.getByTestId('comments-circle')).toBeEnabled();
  });

  it('keeps the comments circle to the right of a post, for the owner too', async () => {
    await renderChannel();

    expect(
      screen
        .getAllByTestId(/^(message-bubble|comments-slot)$/)
        .map((node) => node.props.testID as string),
    ).toEqual(['message-bubble', 'comments-slot']);
  });

  it('switches to the empty «Попсы» section on a segment tap', async () => {
    await renderChannel();

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: 'Попсы' }));
    });

    expect(screen.getByText('Попсов пока нет')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Попсы' }).props.accessibilityState).toMatchObject({
        selected: true,
      }),
    );
  });
});

describe('ChatScreen for a posts chat', () => {
  it('opens the channel screen instead of the bare conversation', async () => {
    await renderWithQuery(<ChatScreen />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/chats/channel/channel-1'));
  });
});
