import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent } from '@testing-library/react-native';

import ChatsScreen from './index';

import type { ChatSummary } from '@/api/chats';
import { listChats, subscribeToOnlineUsers } from '@/api/chats';
import { listInvites, type ChatInvite } from '@/api/invites';
import { useSession } from '@/features/auth/useSession';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
  title: null,
  participants: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT },
    { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: READ_AT },
  ],
  waiting: [],
  lastMessagePreview: 'до встречи',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  hasUnread: false,
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
