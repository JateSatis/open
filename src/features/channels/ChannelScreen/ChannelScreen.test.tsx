jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { ChannelScreen } from '.';

import { getChannel } from '@/api/channels';
import type { ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, subscribeToChat } from '@/api/chats';
import { listMessageViews } from '@/api/messageViews';
import { canPublishInChannel } from '@/api/pops';
import {
  getMySubscription,
  listChannelSubscribers,
  markChannelRead,
  setChannelInChats,
  subscribeToChannel,
  unsubscribeFromChannel,
  type ChannelSubscription,
} from '@/api/subscriptions';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import { ChatRoute as ChatScreen } from '@/navigation/screens/ChatRoute';
import { useSession } from '@/features/auth/useSession';
import { readChatDraft, resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { DeadlineError } from '@/lib/deadline';
import { renderWithQuery } from '@/test/renderWithQuery';
import { longPressMessage } from '@/test/messageGestures';

const mockRedirect = jest.fn();
let mockParams: Record<string, string> = { chatId: 'posts-1' };

jest.mock('@/api/messageViews');
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
// Шапка ставится через ScreenOptions — мок рисует её заголовок и правую часть в дереве.
jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRouteParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn() }),
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirect(href);
    return null;
  },
  ScreenOptions: ({
      options,
    }: {
      options?: { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode };
    }) => (
      <>
        {options?.headerTitle ? options.headerTitle() : null}
        {options?.headerRight ? options.headerRight() : null}
      </>
    ),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/streams');
jest.mock('@/api/channels', () => ({ getChannel: jest.fn() }));
jest.mock('@/api/popTopics', () => ({ acquirePopTopic: () => () => undefined }));
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
  subscribeToChatSignals: jest.fn(() => () => undefined),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  editMessage: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));

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
  subscribersCount: 0,
  readersCount: 0,
};

const postsChat: ChatSummary = {
  id: 'posts-1',
  kind: 'channel',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: null,
  channel: { id: 'channel-1', title: 'Мой канал', username: 'my_channel', avatarUrl: null },
  participants: [{ id: OWNER, displayName: 'Максим', avatarUrl: null, lastReadAt: SENT_AT }],
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
};

const post: Message = {
  id: 'p1',
  chatId: 'posts-1',
  authorId: OWNER,
  kind: 'text',
  text: 'первый пост',
  seq: Date.parse(SENT_AT),
  createdAt: SENT_AT,
  editedAt: null,
  edited: false,
  editMark: null,
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
  mockParams = { chatId: 'posts-1' };
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

    await longPressMessage('p1');
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

describe('ChannelScreen: переход к посту снаружи', () => {
  const selected = (name: string) =>
    screen.getByRole('tab', { name }).props.accessibilityState?.selected;

  it('opens on «Посты» for a jump to a post, even when «Попсы» were asked', async () => {
    await renderWithQuery(<ChannelScreen channelId="channel-1" section="pops" sectionRequest={{ section: 'posts', key: '42' }} />);
    await screen.findByText('первый пост');

    expect(selected('Посты')).toBe(true);
  });

  it('switches a screen left on «Попсы» back to «Посты» on each new jump', async () => {
    const view = await renderWithQuery(<ChannelScreen channelId="channel-1" section="pops" />);
    await screen.findByText('первый пост');
    expect(selected('Попсы')).toBe(true);

    await act(async () => {
      view.rerender(<ChannelScreen channelId="channel-1" section="pops" sectionRequest={{ section: 'posts', key: '42' }} />);
    });
    expect(selected('Посты')).toBe(true);

    // Тот же переход, оставшийся в адресе, раздел, выбранный после, не трогает.
    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: 'Попсы' }));
    });
    await act(async () => {
      view.rerender(<ChannelScreen channelId="channel-1" section="pops" sectionRequest={{ section: 'posts', key: '42' }} />);
    });
    expect(selected('Попсы')).toBe(true);

    await act(async () => {
      view.rerender(<ChannelScreen channelId="channel-1" section="pops" sectionRequest={{ section: 'posts', key: '43' }} />);
    });
    expect(selected('Посты')).toBe(true);
  });

  it('switches a screen left on «Посты» to «Попсы» when «Попсы» are asked', async () => {
    const view = await renderWithQuery(<ChannelScreen channelId="channel-1" />);
    await screen.findByText('первый пост');
    expect(selected('Посты')).toBe(true);

    await act(async () => {
      view.rerender(
        <ChannelScreen channelId="channel-1" sectionRequest={{ section: 'pops', key: '7' }} />,
      );
    });
    expect(selected('Попсы')).toBe(true);
  });
});

describe('ChannelScreen subscription', () => {
  const subscription: ChannelSubscription = {
    channelId: 'channel-1',
    chatId: 'posts-1',
    inChats: true,
    notify: true,
    unreadPosts: 0,
    unreadPops: 0,
    inChatsAt: null,
  };

  // База в миниатюре: подписка и счётчики канала меняются вместе с действиями,
  // и перечитывание после действия отдаёт то же, что увидел бы человек.
  let stored: ChannelSubscription | null = null;

  async function renderAs(userId: string, current: ChannelSubscription | null) {
    signIn(userId);
    stored = current;
    await renderWithQuery(
      <>
        <ChannelScreen channelId="channel-1" />
        <ConfirmDialogHost />
      </>,
    );
    await screen.findByText('первый пост');
  }

  const openPops = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('segment-1'));
    });
  };

  beforeEach(() => {
    resetConfirmDialogQueue();
    stored = null;
    jest.mocked(canPublishInChannel).mockResolvedValue(false);
    jest.mocked(getMySubscription).mockImplementation(async () => stored);
    // Кроме меня — 2 читателя и ещё 1 подписчик без чатов.
    mockedGetChannel.mockImplementation(async () => ({
      ...channel,
      readersCount: 2 + (stored?.inChats ? 1 : 0),
      subscribersCount: 3 + (stored ? 1 : 0),
    }));
    jest.mocked(subscribeToChannel).mockImplementation(async (_id, addToChats) => {
      stored = { ...subscription, inChats: (stored?.inChats ?? false) || addToChats };
    });
    jest.mocked(setChannelInChats).mockImplementation(async (_id, inChats) => {
      if (stored) stored = { ...stored, inChats };
    });
    jest.mocked(unsubscribeFromChannel).mockImplementation(async () => {
      stored = null;
    });
    jest.mocked(markChannelRead).mockImplementation(async (_id, { posts, pops }) => {
      if (!stored) return;

      stored = {
        ...stored,
        unreadPosts: posts ? 0 : stored.unreadPosts,
        unreadPops: pops ? 0 : stored.unreadPops,
        inChatsAt: null,
      };
    });
  });

  it('shows @name.ch with readers on «Посты» and subscribers on «Попсы» in the header', async () => {
    await renderAs('stranger-1', null);

    expect(await screen.findByText('@my_channel.ch · 2 читателя')).toBeTruthy();
    await openPops();
    expect(await screen.findByText('@my_channel.ch · 3 подписчика')).toBeTruthy();
    expect(screen.queryByText('@my_channel.ch · 2 читателя')).toBeNull();
  });

  it('subscribes a stranger from «Посты» straight into chats, without a question', async () => {
    await renderAs('stranger-1', null);

    fireEvent.press(await screen.findByRole('button', { name: 'Подписаться' }));

    await waitFor(() => expect(subscribeToChannel).toHaveBeenCalledWith('channel-1', true));
    expect(screen.queryByText('Хотите добавить в чаты?')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('channel-subscribe-bar')).toBeNull());
    expect(await screen.findByText('@my_channel.ch · 3 читателя')).toBeTruthy();
  });

  it('counts a subscription made from «Попсы» among subscribers, not readers', async () => {
    await renderAs('stranger-1', null);
    await openPops();

    fireEvent.press(await screen.findByRole('button', { name: 'Подписаться' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Нет' }));

    expect(await screen.findByText('@my_channel.ch · 4 подписчика')).toBeTruthy();
  });

  it('asks on «Попсы»; «Нет» leaves a subscriber offered «Добавить в чаты»', async () => {
    await renderAs('stranger-1', null);
    await openPops();

    fireEvent.press(await screen.findByRole('button', { name: 'Подписаться' }));
    expect(await screen.findByText('Хотите добавить в чаты?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Нет' }));

    await waitFor(() => expect(subscribeToChannel).toHaveBeenCalledWith('channel-1', false));
    expect(await screen.findByRole('button', { name: 'Добавить в чаты' })).toBeTruthy();
    expect(setChannelInChats).not.toHaveBeenCalled();
  });

  it('a quick double tap on «Подписаться» is one subscription and one question', async () => {
    await renderAs('stranger-1', null);
    await openPops();

    const button = await screen.findByRole('button', { name: 'Подписаться' });
    // fireEvent is async in RNTL 14: two un-awaited presses overlap act() and break every later
    // test in the file. Awaited, the second tap lands on «Добавить в чаты» — only the guard stops it.
    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(await screen.findAllByText('Хотите добавить в чаты?')).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(subscribeToChannel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Хотите добавить в чаты?')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Добавить в чаты' })).toBeTruthy();
    expect(setChannelInChats).not.toHaveBeenCalled();
  });

  it('closing the question without an answer is «Нет»', async () => {
    await renderAs('stranger-1', null);
    await openPops();

    fireEvent.press(await screen.findByRole('button', { name: 'Подписаться' }));
    fireEvent.press(await screen.findByTestId('confirm-dialog-backdrop'));

    expect(await screen.findByRole('button', { name: 'Добавить в чаты' })).toBeTruthy();
    expect(setChannelInChats).not.toHaveBeenCalled();
  });

  it('«Добавить» on the question adds the channel to chats', async () => {
    await renderAs('stranger-1', null);
    await openPops();

    fireEvent.press(await screen.findByRole('button', { name: 'Подписаться' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(setChannelInChats).toHaveBeenCalledWith('channel-1', true));
    await waitFor(() => expect(screen.queryByTestId('channel-subscribe-bar')).toBeNull());
  });

  it('shows a reader nothing at the bottom and three items under «⋮»', async () => {
    await renderAs('reader-1', subscription);

    fireEvent.press(await screen.findByRole('button', { name: 'Меню канала' }));

    for (const label of ['Выключить уведомления', 'Не отображать в чатах', 'Отписаться']) {
      expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('menuitem', { name: 'Подписчики' })).toBeNull();
    expect(screen.queryByTestId('channel-subscribe-bar')).toBeNull();

    fireEvent.press(screen.getByRole('menuitem', { name: 'Отписаться' }));
    await waitFor(() => expect(unsubscribeFromChannel).toHaveBeenCalledWith('channel-1'));
    expect(await screen.findByRole('button', { name: 'Подписаться' })).toBeTruthy();
  });

  it('offers a subscriber without chats «Добавить в чаты» and «Отписаться» only', async () => {
    await renderAs('reader-1', { ...subscription, inChats: false });

    fireEvent.press(await screen.findByRole('button', { name: 'Меню канала' }));

    expect(await screen.findByRole('menuitem', { name: 'Добавить в чаты' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Отписаться' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Выключить уведомления' })).toBeNull();
  });

  it('gives a stranger no «⋮» and no unread counters', async () => {
    await renderAs('stranger-1', null);

    await screen.findByRole('button', { name: 'Подписаться' });
    expect(screen.queryByRole('button', { name: 'Меню канала' })).toBeNull();
    expect(screen.queryByTestId('segment-badge-0')).toBeNull();
    expect(screen.queryByTestId('segment-badge-1')).toBeNull();
  });

  it('gives the creator «Подписчики» and no subscribe button', async () => {
    jest.mocked(canPublishInChannel).mockResolvedValue(true);
    await renderAs(OWNER, null);

    fireEvent.press(await screen.findByRole('button', { name: 'Меню канала' }));

    expect(await screen.findByRole('menuitem', { name: 'Подписчики' })).toBeTruthy();
    expect(screen.queryByTestId('channel-subscribe-bar')).toBeNull();
    expect(getMySubscription).not.toHaveBeenCalled();
    expect(listChannelSubscribers).not.toHaveBeenCalled();
  });

  it('shows unread counts per section; loading «Посты» preserves the count until a reached position', async () => {
    await renderAs('reader-1', { ...subscription, unreadPosts: 3, unreadPops: 2 });

    expect(await screen.findByTestId('segment-badge-1')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Попсы, непрочитанных: 2' })).toBeTruthy();
    expect(markChannelRead).not.toHaveBeenCalledWith('channel-1', { posts: true, pops: false });
    expect(screen.getByRole('tab', { name: 'Посты, непрочитанных: 3' })).toBeTruthy();

    await openPops();
    await waitFor(() =>
      expect(markChannelRead).toHaveBeenCalledWith('channel-1', { posts: false, pops: true }),
    );
    await waitFor(() => expect(screen.queryByTestId('segment-badge-1')).toBeNull());
  });
});

describe('ChatScreen for a posts chat', () => {
  it('opens the channel screen instead of the bare conversation', async () => {
    await renderWithQuery(<ChatScreen />);

    await waitFor(() =>
      expect(mockRedirect).toHaveBeenCalledWith({
        name: 'Channel',
        params: { channelId: 'channel-1' },
      }),
    );
  });

  it('drops legacy message targets when redirecting a posts chat', async () => {
    mockParams = {
      chatId: 'posts-1',
      jumpTo: 'p1',
      jumpSeq: SENT_AT,
      jumpKey: '42',
      comments: 'p1',
      comment: 'c1',
    };

    await renderWithQuery(<ChatScreen />);

    await waitFor(() =>
      expect(mockRedirect).toHaveBeenCalledWith({
        name: 'Channel',
        params: {
          channelId: 'channel-1',
        },
      }),
    );
  });
});

describe('ChannelScreen: не удалось открыть', () => {
  beforeEach(() => signIn(OWNER));

  it('сервер не ответил — «Не удалось открыть канал», «Повторить» открывает канал', async () => {
    mockedGetChannel.mockRejectedValueOnce(new DeadlineError());

    await renderWithQuery(<ChannelScreen channelId="channel-1" />);

    expect(await screen.findByText('Не удалось открыть канал')).toBeTruthy();
    expect(screen.queryByText('Нет связи')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Повторить'));
    });

    expect(await screen.findByText('первый пост')).toBeTruthy();
    expect(screen.queryByText('Не удалось открыть канал')).toBeNull();
  });

  it('не загрузились посты — экран сбоя в «Постах», а не «Постов пока нет»', async () => {
    mockedListMessages.mockRejectedValue(new DeadlineError());

    await renderWithQuery(<ChannelScreen channelId="channel-1" />);

    expect(await screen.findByText('Не удалось загрузить переписку')).toBeTruthy();
    expect(screen.queryByText('Постов пока нет.')).toBeNull();
  });
});
