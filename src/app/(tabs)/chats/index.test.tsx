import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent } from '@testing-library/react-native';

import ChatsScreen from './index';

import type { ChatSummary, DirectCandidate } from '@/api/chats';
import {
  getOrCreateDirectChat,
  listChats,
  listDirectCandidates,
  subscribeToOnlineUsers,
} from '@/api/chats';
import { useSession } from '@/features/auth/useSession';
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
  listDirectCandidates: jest.fn(),
  getOrCreateDirectChat: jest.fn(),
  subscribeToOnlineUsers: jest.fn(),
}));

const mockedListChats = listChats as jest.MockedFunction<typeof listChats>;
const mockedCandidates = listDirectCandidates as jest.MockedFunction<typeof listDirectCandidates>;
const mockedOpenDirect = getOrCreateDirectChat as jest.MockedFunction<typeof getOrCreateDirectChat>;
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
  lastMessagePreview: 'до встречи',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  hasUnread: false,
};

const stranger: DirectCandidate = { id: 'user-3', displayName: 'Пётр', avatarUrl: null };

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs('user-1');
  mockedPresence.mockReturnValue(() => {});
  mockedListChats.mockResolvedValue([]);
  mockedCandidates.mockResolvedValue([]);
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

  it('lists everyone else so a first message needs no search', async () => {
    mockedCandidates.mockResolvedValue([stranger]);

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('Все пользователи')).toBeTruthy();
    expect(screen.getByText('Пётр')).toBeTruthy();
  });

  it('does not list a person twice when a chat with them already exists', async () => {
    mockedListChats.mockResolvedValue([chat]);
    mockedCandidates.mockResolvedValue([
      { id: 'user-2', displayName: 'Марина', avatarUrl: null },
      stranger,
    ]);

    await renderWithQuery(<ChatsScreen />);

    await screen.findByText('Пётр');
    expect(screen.getAllByText('Марина')).toHaveLength(1);
  });

  it('opens a dialogue with a person who has no chat yet', async () => {
    mockedCandidates.mockResolvedValue([stranger]);
    mockedOpenDirect.mockResolvedValue('chat-new');
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByText('Пётр'));

    // Вторым аргументом TanStack Query передаёт свой контекст мутации.
    expect(mockedOpenDirect).toHaveBeenCalledWith('user-3', expect.anything());
    expect(mockPush).toHaveBeenCalledWith('/chats/chat-new');
  });

  it('reports a failure to open a dialogue instead of staying silent', async () => {
    mockedCandidates.mockResolvedValue([stranger]);
    mockedOpenDirect.mockRejectedValue(new Error('Пользователь не найден'));
    const user = userEvent.setup();

    await renderWithQuery(<ChatsScreen />);
    await user.press(await screen.findByText('Пётр'));

    expect(await screen.findByText('Пользователь не найден')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
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
    mockedListChats.mockRejectedValue(new Error('Сеть недоступна'));

    await renderWithQuery(<ChatsScreen />);

    expect(await screen.findByText('Сеть недоступна')).toBeTruthy();
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
