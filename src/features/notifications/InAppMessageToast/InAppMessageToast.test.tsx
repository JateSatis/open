import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';

import { InAppMessageToast } from './index';

import {
  subscribeToUserEvents,
  type ChatSummary,
  type IncomingInvite,
  type IncomingMessage,
  type IncomingPop,
  type UserChannelHandlers,
} from '@/api/chats';
import { useSession } from '@/features/auth/useSession';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { friendKeys } from '@/features/friends/keys';
import { showNotice } from '@/features/notifications/alertsStore';
import { setActiveChatId } from '@/store/activeChat';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
}));

// Звонок поднимает LiveKit и Supabase — здесь важно лишь, что из него выходят.
jest.mock('@/features/streams/callSession', () => ({ leaveCall: jest.fn() }));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  subscribeToUserEvents: jest.fn(),
}));

jest.mock('@/api/invites', () => ({}));

const mockedSubscribe = subscribeToUserEvents as jest.MockedFunction<typeof subscribeToUserEvents>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

let handlers: UserChannelHandlers | null = null;
const deliver = (message: IncomingMessage) => handlers?.onMessage(message);
const deliverInvite = (invite: IncomingInvite) => handlers?.onInvite(invite);
const deliverPop = (pop: IncomingPop) => handlers?.onPop?.(pop);

const channel = { id: 'channel-1', title: 'Плейлисты', avatarUrl: null };
const post: IncomingMessage = {
  messageId: 'p1',
  chatId: 'posts-1',
  authorId: 'owner-1',
  authorName: 'Владелец',
  messageKind: 'text',
  text: 'новый трек',
  channel,
  subscribedChatTitle: null,
  notify: true,
};
const pop: IncomingPop = {
  popId: 'pop-1',
  chatId: 'posts-1',
  channel,
  notify: true,
  createdAt: '2026-10-11T10:00:00Z',
};

const incoming: IncomingMessage = {
  messageId: 'm1',
  chatId: 'chat-1',
  authorId: 'user-2',
  authorName: 'Марина',
  messageKind: 'text',
  text: 'ты где',
  channel: null,
  subscribedChatTitle: null,
  notify: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  setActiveChatId(null);
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedSubscribe.mockImplementation((_userId, received) => {
    handlers = received;
    return () => {};
  });
});

describe('InAppMessageToast', () => {
  it('stays out of the way until a message arrives', async () => {
    await renderWithQuery(<InAppMessageToast />);

    expect(screen.queryByText('Марина')).toBeNull();
  });

  it('shows who wrote and what they wrote', async () => {
    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('ты где')).toBeTruthy();
  });

  it('opens the chat it came from when tapped', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);
    await user.press(await screen.findByText('ты где'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: { chatId: 'chat-1', from: 'notification' },
    });
    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('signs a group message by the group — its title and photo — and names the author', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    queryClient.setQueryData<Partial<ChatSummary>[]>(chatsQueryKey, [
      {
        id: 'group-1',
        kind: 'group',
        title: 'Поход',
        avatarUrl: 'https://x/g.jpg',
        channel: null,
        participants: [],
        waiting: [],
      },
    ]);

    await render(
      <QueryClientProvider client={queryClient}>
        <InAppMessageToast />
      </QueryClientProvider>,
    );

    deliver({ ...incoming, chatId: 'group-1' });

    expect(await screen.findByText('Марина: ты где')).toBeTruthy();
    expect(screen.getByLabelText('Новое сообщение в «Поход» от Марина')).toBeTruthy();
    // Фото группы подписано её названием; буквы на его месте нет.
    expect(screen.getByLabelText('Поход')).toBeTruthy();
    expect(screen.queryByText('П')).toBeNull();
    queryClient.clear();
  });

  it('titles a message in a subscribed dialogue by the dialogue and names the author', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliver({
      ...incoming,
      chatId: 'their-chat',
      authorName: 'Пётр',
      text: 'Аня, привет',
      subscribedChatTitle: 'Аня и Пётр',
    });

    expect(await screen.findByText('Аня и Пётр')).toBeTruthy();
    expect(screen.getByText('Пётр: Аня, привет')).toBeTruthy();

    await user.press(screen.getByText('Пётр: Аня, привет'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: { chatId: 'their-chat', from: 'notification' },
    });
  });

  it('stays silent about a subscribed dialogue with notifications off', async () => {
    await renderWithQuery(<InAppMessageToast />);

    deliver({ ...incoming, subscribedChatTitle: 'Аня и Пётр', notify: false });

    await waitFor(() => expect(screen.queryByText('Аня и Пётр')).toBeNull());
  });

  it('keeps quiet about the chat the user is already reading', async () => {
    setActiveChatId('chat-1');

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('still reports a message from another chat while one is open', async () => {
    setActiveChatId('chat-2');

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    expect(await screen.findByText('ты где')).toBeTruthy();
  });

  it('announces an invite and opens the chat it invites to', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliverInvite({
      chatId: 'chat-7',
      inviterId: 'user-2',
      inviterName: 'Марина',
      chatTitle: 'Поход',
    });
    expect(await screen.findByText('Марина')).toBeTruthy();
    await user.press(screen.getByText('Зовёт вас в чат «Поход»'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: { chatId: 'chat-7', from: 'notification' },
    });
  });

  it('signs a channel post with the channel and opens its «Посты»', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(async () => deliver(post));
    expect(await screen.findByText('Плейлисты')).toBeTruthy();
    expect(screen.queryByText('Владелец')).toBeNull();
    await user.press(screen.getByText('новый трек'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'channel-1', section: 'posts' },
    });
  });

  it('stays silent for a channel with notifications off', async () => {
    await renderWithQuery(<InAppMessageToast />);

    await act(async () => deliver({ ...post, notify: false }));
    await act(async () => deliverPop({ ...pop, notify: false }));

    await waitFor(() => expect(screen.queryByText('Плейлисты')).toBeNull());
  });

  it('announces a new pop and opens the channel on «Попсы»', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(async () => deliverPop(pop));
    await user.press(await screen.findByText('Новый попс'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'channel-1', section: 'pops' },
    });
  });

  it('keeps quiet about a pop of the channel being read', async () => {
    setActiveChatId('posts-1');

    await renderWithQuery(<InAppMessageToast />);

    await act(async () => deliverPop(pop));

    await waitFor(() => expect(screen.queryByText('Новый попс')).toBeNull());
  });

  it('runs the action of a notice that carries one and closes', async () => {
    const retry = jest.fn();

    await renderWithQuery(<InAppMessageToast />);
    await act(async () =>
      showNotice('Изменения не сохранены', 'error', { label: 'Повторить', run: retry }),
    );

    await userEvent.setup().press(await screen.findByTestId('notice-action-button'));

    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Изменения не сохранены')).toBeNull());
  });

  it('refreshes friends, requests and people when a friendship changes, without a card', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    queryClient.setQueryData(friendKeys.summary('user-1'), { friendsCount: 0, incomingCount: 0 });
    queryClient.setQueryData<Partial<ChatSummary>[]>(chatsQueryKey, []);
    queryClient.setQueryData(['messages', 'chat-1'], { pages: [], pageParams: [] });
    await render(
      <QueryClientProvider client={queryClient}>
        <InAppMessageToast />
      </QueryClientProvider>,
    );

    await act(async () => handlers?.onFriendsChanged?.());

    expect(queryClient.getQueryState(friendKeys.summary('user-1'))?.isInvalidated).toBe(true);
    // Имена в списке чатов: другу видно настоящее, бывшему — псевдоним.
    expect(queryClient.getQueryState(chatsQueryKey)?.isInvalidated).toBe(true);
    // Переписка тоже устарела, но перечитается при открытии, а не сейчас.
    expect(queryClient.getQueryState(['messages', 'chat-1'])?.isInvalidated).toBe(true);
    expect(screen.toJSON()).toBeNull();
    queryClient.clear();
  });

  it('leaves no channel behind on unmount', async () => {
    const unsubscribe = jest.fn();
    mockedSubscribe.mockReturnValue(unsubscribe);

    await renderWithQuery(<InAppMessageToast />);
    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
