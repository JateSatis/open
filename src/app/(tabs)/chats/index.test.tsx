import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { render, screen, userEvent } from '@testing-library/react-native';

import ChatsScreen from './index';

import type { ChatSummary } from '@/api/chats';
import { listChats, subscribeToOnlineUsers } from '@/api/chats';
import { useSession } from '@/features/auth/useSession';

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

const mockedListChats = listChats as jest.MockedFunction<typeof listChats>;
const mockedPresence = subscribeToOnlineUsers as jest.MockedFunction<typeof subscribeToOnlineUsers>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

function signedInAs(userId: string) {
  mockedSession.mockReturnValue({
    session: { user: { id: userId } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
}

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: null,
  participants: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null },
    { id: 'user-2', displayName: 'Марина', avatarUrl: null },
  ],
  lastMessagePreview: 'до встречи',
  lastMessageAt: '2026-09-16T10:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs('user-1');
  mockedPresence.mockReturnValue(() => {});
});

describe('ChatsScreen', () => {
  it('shows the other side of a direct chat with its last message', async () => {
    mockedListChats.mockResolvedValue([chat]);

    await render(<ChatsScreen />);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('до встречи')).toBeTruthy();
  });

  it('marks a chat partner who is present as online', async () => {
    mockedListChats.mockResolvedValue([chat]);
    mockedPresence.mockImplementation((_userId, onChange) => {
      onChange(['user-1', 'user-2']);
      return () => {};
    });

    await render(<ChatsScreen />);

    expect(await screen.findByText('в сети')).toBeTruthy();
  });

  it('opens the conversation when a chat is tapped', async () => {
    mockedListChats.mockResolvedValue([chat]);
    const user = userEvent.setup();

    await render(<ChatsScreen />);
    await user.press(await screen.findByText('Марина'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-1');
  });

  it('reports a failure to load instead of showing an empty list', async () => {
    mockedListChats.mockRejectedValue(new Error('Сеть недоступна'));

    await render(<ChatsScreen />);

    expect(await screen.findByText('Сеть недоступна')).toBeTruthy();
  });

  it('leaves no presence channel behind on unmount', async () => {
    const unsubscribe = jest.fn();
    mockedListChats.mockResolvedValue([chat]);
    mockedPresence.mockReturnValue(unsubscribe);

    await render(<ChatsScreen />);
    await screen.findByText('Марина');
    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
