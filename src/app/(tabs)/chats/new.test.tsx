import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent } from '@testing-library/react-native';

import NewChatScreen from './new';

import { listPeople, subscribeToOnlineUsers } from '@/api/chats';
import { createChat, DuplicateChatError } from '@/api/invites';
import { useSession } from '@/features/auth/useSession';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  listPeople: jest.fn(),
  subscribeToOnlineUsers: jest.fn(),
}));

jest.mock('@/api/invites', () => {
  class MockDuplicateChatError extends Error {
    readonly chatId: string;

    constructor(mockChatId: string) {
      super('duplicate');
      this.chatId = mockChatId;
    }
  }

  return { createChat: jest.fn(), DuplicateChatError: MockDuplicateChatError };
});

const mockedPeople = listPeople as jest.MockedFunction<typeof listPeople>;
const mockedCreate = createChat as jest.MockedFunction<typeof createChat>;
const mockedPresence = subscribeToOnlineUsers as jest.MockedFunction<typeof subscribeToOnlineUsers>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedPresence.mockReturnValue(() => {});
  mockedPeople.mockResolvedValue([
    { id: 'user-2', displayName: 'Марина', avatarUrl: null },
    { id: 'user-3', displayName: 'Пётр', avatarUrl: null },
  ]);
  mockedCreate.mockResolvedValue({ outcome: 'created', chatId: 'chat-new' });
  resetConnectionState();
  reportRealtimeJoined();
});

describe('NewChatScreen', () => {
  it('cannot create a chat until someone is picked', async () => {
    await renderWithQuery(<NewChatScreen />);

    await screen.findByText('Марина');
    expect(screen.getByRole('button', { name: 'Выберите, кого позвать' })).toBeDisabled();
  });

  it('invites one person into a dialogue and opens it', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(mockedCreate).toHaveBeenCalledWith(
      { inviteeIds: ['user-2'], title: '' },
      expect.anything(),
    );
    expect(mockReplace).toHaveBeenCalledWith('/chats/chat-new');
  });

  it('invites several people into a titled group', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Пётр'));
    await user.type(screen.getByLabelText('Название чата'), 'Поход');
    await user.press(screen.getByText('Позвать в группу (2)'));

    expect(mockedCreate).toHaveBeenCalledWith(
      { inviteeIds: ['user-2', 'user-3'], title: 'Поход' },
      expect.anything(),
    );
  });

  it('unpicks a person on a second tap', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Марина'));

    expect(screen.getByRole('checkbox', { name: 'Марина' })).not.toBeChecked();
    expect(screen.getByText('Выберите, кого позвать')).toBeTruthy();
  });

  it('opens the invite from the same people instead of a second chat', async () => {
    mockedCreate.mockResolvedValue({ outcome: 'incoming_invite', chatId: 'chat-theirs' });
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(mockReplace).toHaveBeenCalledWith('/chats/chat-theirs');
  });

  it('explains a repeat invite and leads to the chat that is still waiting', async () => {
    mockedCreate.mockRejectedValue(new DuplicateChatError('chat-old'));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(await screen.findByText(/Вы уже позвали этих людей/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await user.press(screen.getByText('Открыть тот чат'));
    expect(mockReplace).toHaveBeenCalledWith('/chats/chat-old');
  });

  it('reports a failure in plain words, not in server wording', async () => {
    mockedCreate.mockRejectedValue(new Error('permission denied for function create_chat'));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(await screen.findByText('Не удалось создать чат')).toBeTruthy();
    expect(screen.queryByText(/permission/)).toBeNull();
  });
});
