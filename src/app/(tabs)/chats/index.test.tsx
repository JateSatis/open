import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

import ChatsScreen from './index';

import type { ChatSummary } from '@/api/chats';
import { listChats, subscribeToOnlineUsers } from '@/api/chats';
import { listInvites, type ChatInvite } from '@/api/invites';
import {
  markChannelRead,
  markChatSubscriptionRead,
  setChannelInChats,
  setChannelNotifications,
  setChatNotifications,
  unsubscribeFromChannel,
  unsubscribeFromChat,
  type ChannelSubscription,
} from '@/api/subscriptions';
import { useSession } from '@/features/auth/useSession';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

// Поиск — отдельный файл (index.search.test.tsx); здесь он лишь не ходит в сеть.
jest.mock('@/api/search', () => ({
  searchEntities: jest.fn().mockResolvedValue([]),
  searchMessages: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  listChats: jest.fn(),
  subscribeToOnlineUsers: jest.fn(),
}));

jest.mock('@/api/invites', () => ({
  listInvites: jest.fn(),
}));

const mockedListChats = listChats as jest.MockedFunction<typeof listChats>;
const mockedInvites = listInvites as jest.MockedFunction<typeof listInvites>;
const mockedPresence = subscribeToOnlineUsers as jest.MockedFunction<typeof subscribeToOnlineUsers>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

function signedInAs(userId: string) {
  mockedSession.mockReturnValue({
    session: { user: { id: userId } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
}

const READ_AT = '2026-09-16T09:00:00Z';

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: null,
  participants: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT },
    { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: READ_AT },
  ],
  waiting: [],
  lastMessagePreview: 'до встречи',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  lastPopAt: null,
  lastActivityAt: '2026-09-16T10:00:00Z',
  enteredAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 0,
  username: null,
  channel: null,
};

function invite(chatId: string, status: ChatInvite['status']): ChatInvite {
  return {
    chatId,
    status,
    invitedAt: '2026-09-16T10:00:00Z',
    inviter: { id: 'user-3', displayName: 'Пётр', avatarUrl: null },
    chat: { ...chat, id: chatId },
    recentMessages: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs('user-1');
  mockedPresence.mockReturnValue(() => {});
  mockedListChats.mockResolvedValue([]);
  mockedInvites.mockResolvedValue([]);
  // Плашка о сбое загрузки появляется только при живой связи: об обрыве
  // говорит шапка, и дублировать её красным текстом незачем.
  resetConnectionState();
  reportRealtimeJoined();
});

describe('ChatsScreen', () => {
  it('shows the other side of a direct chat with its last message', async () => {
    mockedListChats.mockResolvedValue([chat]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('до встречи')).toBeTruthy();
  });

  it('shows a channel under its own name, marked «Канал», and opens the channel screen', async () => {
    mockedListChats.mockResolvedValue([
      {
        ...chat,
        id: 'posts-1',
        kind: 'channel',
        channel: { id: 'channel-1', title: 'Новости', username: 'news', avatarUrl: null },
      },
    ]);
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByRole('button', { name: 'Новости' }));

    expect(screen.getByText('Канал')).toBeTruthy();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'channel-1', section: 'posts' },
    });
  });

  describe('channel I read', () => {
    const subscription: ChannelSubscription = {
      channelId: 'channel-1',
      chatId: 'posts-1',
      inChats: true,
      notify: true,
      unreadPosts: 0,
      unreadPops: 1,
      inChatsAt: null,
    };
    const readChannel: ChatSummary = {
      ...chat,
      id: 'posts-1',
      kind: 'channel',
      channel: { id: 'channel-1', title: 'Новости', username: 'news', avatarUrl: null },
      participants: [{ id: 'owner-1', displayName: 'Автор', avatarUrl: null, lastReadAt: READ_AT }],
      lastMessagePreview: 'старый пост',
      lastMessageAuthorId: 'owner-1',
      lastPopAt: '2026-09-16T11:00:00Z',
      lastActivityAt: '2026-09-16T11:00:00Z',
      enteredAt: null,
      previewIsPop: true,
      subscription,
      hasUnread: true,
    };

    it('shows «Новый попс» when a pop without a post is the freshest, and opens «Попсы»', async () => {
      mockedListChats.mockResolvedValue([readChannel]);
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);

      expect(await screen.findByText('Новый попс')).toBeTruthy();
      expect(screen.queryByText('старый пост')).toBeNull();
      expect(screen.getByLabelText('Есть непрочитанные сообщения')).toBeTruthy();

      await user.press(screen.getByRole('button', { name: 'Новости' }));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/channel/[channelId]',
        params: { channelId: 'channel-1', section: 'pops' },
      });
    });

    it('opens «Посты» when the fresher unread is a post', async () => {
      mockedListChats.mockResolvedValue([
        {
          ...readChannel,
          lastMessageAt: '2026-09-16T12:00:00Z',
          lastActivityAt: '2026-09-16T12:00:00Z',
          enteredAt: null,
          previewIsPop: false,
          subscription: { ...subscription, unreadPosts: 2 },
        },
      ]);
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      await user.press(await screen.findByRole('button', { name: 'Новости' }));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/channel/[channelId]',
        params: { channelId: 'channel-1', section: 'posts' },
      });
    });

    it('offers the four subscription actions on a long press', async () => {
      mockedListChats.mockResolvedValue([readChannel]);

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Новости' }), 'longPress');

      const menu = await screen.findByTestId('subscription-menu');

      expect(menu).toBeTruthy();
      for (const label of [
        'Прочитать все',
        'Выключить уведомления',
        'Не отображать в чатах',
        'Отписаться',
      ]) {
        expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
      }
    });

    it.each([
      [
        'Прочитать все',
        () =>
          expect(markChannelRead).toHaveBeenCalledWith('channel-1', { posts: true, pops: true }),
      ],
      [
        'Выключить уведомления',
        () => expect(setChannelNotifications).toHaveBeenCalledWith('channel-1', false),
      ],
      [
        'Не отображать в чатах',
        () => expect(setChannelInChats).toHaveBeenCalledWith('channel-1', false),
      ],
      ['Отписаться', () => expect(unsubscribeFromChannel).toHaveBeenCalledWith('channel-1')],
    ])('«%s» goes to the database', async (label, check) => {
      mockedListChats.mockResolvedValue([readChannel]);
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Новости' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: label }));

      await waitFor(check);
    });

    it('removes the row right away when hidden from chats', async () => {
      mockedListChats.mockResolvedValue([readChannel]);
      // Перечитанный список — уже без канала.
      (setChannelInChats as jest.Mock).mockImplementation(async () => {
        mockedListChats.mockResolvedValue([]);
      });
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Новости' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: 'Не отображать в чатах' }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Новости' })).toBeNull());
    });

    it('keeps the row and drops only the dot on «Прочитать все»', async () => {
      mockedListChats.mockResolvedValue([readChannel]);
      (markChannelRead as jest.Mock).mockImplementation(() => new Promise(() => undefined));
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Новости' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: 'Прочитать все' }));

      await waitFor(() =>
        expect(screen.queryByLabelText('Есть непрочитанные сообщения')).toBeNull(),
      );
      expect(screen.getByRole('button', { name: 'Новости' })).toBeTruthy();
    });

    it('does nothing on a long press of my own chat or channel', async () => {
      mockedListChats.mockResolvedValue([chat]);

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Марина' }), 'longPress');

      expect(screen.queryByTestId('subscription-menu')).toBeNull();
    });
  });

  describe('dialogue I subscribed to', () => {
    const theirs: ChatSummary = {
      ...chat,
      id: 'their-1',
      participants: [
        { id: 'user-2', displayName: 'Аня', avatarUrl: null, lastReadAt: READ_AT },
        { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT },
      ],
      lastMessagePreview: 'Аня, привет',
      lastMessageAuthorId: 'user-3',
      subscription: {
        channelId: null,
        chatId: 'their-1',
        inChats: true,
        notify: true,
        unreadPosts: 1,
        unreadPops: 0,
        inChatsAt: null,
      },
      hasUnread: true,
    };

    it('names it after both people, with two avatars and the unread dot', async () => {
      mockedListChats.mockResolvedValue([theirs]);
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);

      expect(await screen.findByText('Аня и Пётр')).toBeTruthy();
      expect(screen.getByTestId('chat-avatar-pair')).toBeTruthy();
      expect(screen.getByText('Аня, привет')).toBeTruthy();
      expect(screen.getByLabelText('Есть непрочитанные сообщения')).toBeTruthy();

      await user.press(screen.getByRole('button', { name: 'Аня и Пётр' }));
      expect(mockPush).toHaveBeenCalledWith('/chats/their-1');
    });

    it('offers three actions on a long press — no «Не отображать в чатах»', async () => {
      mockedListChats.mockResolvedValue([theirs]);

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Аня и Пётр' }), 'longPress');

      expect(await screen.findByTestId('subscription-menu')).toBeTruthy();
      for (const label of ['Прочитать все', 'Выключить уведомления', 'Отписаться']) {
        expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
      }
      expect(screen.queryByRole('menuitem', { name: 'Не отображать в чатах' })).toBeNull();
    });

    it.each([
      ['Прочитать все', () => expect(markChatSubscriptionRead).toHaveBeenCalledWith('their-1')],
      [
        'Выключить уведомления',
        () => expect(setChatNotifications).toHaveBeenCalledWith('their-1', false),
      ],
      ['Отписаться', () => expect(unsubscribeFromChat).toHaveBeenCalledWith('their-1')],
    ])('«%s» goes to the database for the chat', async (label, check) => {
      mockedListChats.mockResolvedValue([theirs]);
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Аня и Пётр' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: label }));

      await waitFor(check);
    });

    it('drops the row right away on «Отписаться» and the dot on «Прочитать все»', async () => {
      mockedListChats.mockResolvedValue([theirs]);
      // Перечитанный список держим прежним: строка уходит сама, оптимистично.
      (unsubscribeFromChat as jest.Mock).mockImplementation(() => new Promise(() => undefined));
      (markChatSubscriptionRead as jest.Mock).mockImplementation(
        () => new Promise(() => undefined),
      );
      const user = userEvent.setup();

      await renderWithQuery(<ChatsScreen />);
      fireEvent(await screen.findByRole('button', { name: 'Аня и Пётр' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: 'Прочитать все' }));
      await waitFor(() =>
        expect(screen.queryByLabelText('Есть непрочитанные сообщения')).toBeNull(),
      );

      fireEvent(screen.getByRole('button', { name: 'Аня и Пётр' }), 'longPress');
      await user.press(await screen.findByRole('menuitem', { name: 'Отписаться' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Аня и Пётр' })).toBeNull(),
      );
    });
  });

  it('keeps the «+» button even when there are no chats', async () => {
    mockedListChats.mockResolvedValue([]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByRole('button', { name: 'Новый чат' })).toBeTruthy();
    expect(screen.getByTestId('create-button')).toBeTruthy();
  });

  it('opens the people picker from «+» → «Чат»', async () => {
    mockedListChats.mockResolvedValue([chat]);
    const measure = jest
      .spyOn(
        View.prototype as unknown as {
          measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
        },
        'measureInWindow',
      )
      .mockImplementation((callback) => callback(300, 600, 56, 56));

    await renderWithQuery(<ChatsScreen />);
    await screen.findByText('Марина');

    expect(screen.queryByRole('button', { name: 'Новый чат' })).toBeNull();

    fireEvent.press(screen.getByTestId('create-button'));
    fireEvent.press(await screen.findByRole('menuitem', { name: 'Чат' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chats/new'));
    measure.mockRestore();
  });

  it('marks a chat with an unread message', async () => {
    mockedListChats.mockResolvedValue([{ ...chat, hasUnread: true }]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByLabelText('Есть непрочитанные сообщения')).toBeTruthy();
  });

  it('leaves a read chat without the unread mark', async () => {
    mockedListChats.mockResolvedValue([chat]);

    await renderWithQuery(<ChatsScreen />);

    await screen.findByText('Марина');
    expect(screen.queryByLabelText('Есть непрочитанные сообщения')).toBeNull();
  });

  it('shows the invites row with the number of incoming ones', async () => {
    mockedListChats.mockResolvedValue([chat]);
    mockedInvites.mockResolvedValue([
      invite('chat-7', 'pending'),
      invite('chat-8', 'pending'),
      invite('chat-9', 'declined'),
    ]);
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByLabelText('Заявки: 2'));

    expect(mockPush).toHaveBeenCalledWith('/chats/invites');
  });

  it('keeps the invites row for declined ones so they can still be accepted', async () => {
    mockedInvites.mockResolvedValue([invite('chat-9', 'declined')]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByLabelText('Заявки')).toBeTruthy();
  });

  it('has no invites row when there are no invites', async () => {
    mockedListChats.mockResolvedValue([chat]);

    await renderWithQuery(<ChatsScreen />);

    await screen.findByText('Марина');
    expect(screen.queryByText('Заявки')).toBeNull();
  });

  it('names a dialogue after the invitee while the invite is unanswered', async () => {
    mockedListChats.mockResolvedValue([
      {
        ...chat,
        participants: [chat.participants[0]],
        waiting: [{ id: 'user-2', displayName: 'Марина', avatarUrl: null }],
      },
    ]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('ждём ответа на заявку')).toBeTruthy();
  });

  it('offers to start a chat when there are none', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByText('Новый чат'));

    expect(mockPush).toHaveBeenCalledWith('/chats/new');
  });

  it('marks a chat partner who is present as online', async () => {
    mockedListChats.mockResolvedValue([chat]);
    mockedPresence.mockImplementation((_userId, onChange) => {
      onChange(['user-1', 'user-2']);
      return () => {};
    });

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('в сети')).toBeTruthy();
  });

  it('opens the conversation when a chat is tapped', async () => {
    mockedListChats.mockResolvedValue([chat]);
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByText('Марина'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-1');
  });

  it('reports a failure to load instead of showing an empty list', async () => {
    mockedListChats.mockRejectedValue(new Error('unexpected token in response'));

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('Не удалось загрузить чаты')).toBeTruthy();
  });

  it('stays quiet about a lost connection: the header already says it', async () => {
    mockedListChats.mockRejectedValue(new Error('Network request failed'));
    mockedInvites.mockResolvedValue([invite('chat-9', 'pending')]);

    await renderWithQuery(<ChatsScreen />);

    // Красная плашка с java.net.UnknownHostException ничего не объясняет
    // человеку и только перекрывает то, что уже загружено.
    await screen.findByText('Заявки');
    expect(screen.queryByText(/Не удалось загрузить чаты/)).toBeNull();
    expect(screen.queryByText(/Network request failed/)).toBeNull();
  });

  it('leaves no presence channel behind on unmount', async () => {
    const unsubscribe = jest.fn();
    mockedListChats.mockResolvedValue([chat]);
    mockedPresence.mockReturnValue(unsubscribe);

    await renderWithQuery(<ChatsScreen />);
    await screen.findByText('Марина');
    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
