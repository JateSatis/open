import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent } from '@testing-library/react-native';

import InvitesScreen from './invites';

import type { ChatSummary } from '@/api/chats';
import { acceptInvite, declineInvite, listInvites, type ChatInvite } from '@/api/invites';
import { useSession } from '@/features/auth/useSession';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

// Экран сам в чаты не ходит, но хуки ответа на заявку тянут модуль ради
// ключей кеша — без мока он поднял бы настоящий клиент Supabase.
jest.mock('@/api/chats', () => ({}));

jest.mock('@/api/invites', () => ({
  listInvites: jest.fn(),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));

const mockedList = listInvites as jest.MockedFunction<typeof listInvites>;
const mockedAccept = acceptInvite as jest.MockedFunction<typeof acceptInvite>;
const mockedDecline = declineInvite as jest.MockedFunction<typeof declineInvite>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const READ_AT = '2026-09-16T09:00:00Z';
const marina = { id: 'user-2', displayName: 'Марина', avatarUrl: null };

const group: ChatSummary = {
  id: 'chat-7',
  kind: 'group',
  title: 'Поход',
  participants: [{ ...marina, lastReadAt: READ_AT }],
  waiting: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null },
    { id: 'user-3', displayName: 'Пётр', avatarUrl: null },
  ],
  lastMessagePreview: 'берём палатку?',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  hasUnread: false,
};

function invite(overrides: Partial<ChatInvite> = {}): ChatInvite {
  return {
    chatId: 'chat-7',
    status: 'pending',
    invitedAt: '2026-09-16T10:00:00Z',
    inviter: marina,
    chat: group,
    recentMessages: [
      {
        id: 'm1',
        chatId: 'chat-7',
        authorId: 'user-2',
        kind: 'text',
        text: 'берём палатку?',
        createdAt: '2026-09-16T10:00:00Z',
        editedAt: null,
        attachments: [],
        replies: [],
        forward: null,
        reactions: { members: {}, visitors: {}, mine: null },
        commentsCount: 0,
        viewsCount: 0,
        readAt: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedAccept.mockResolvedValue(undefined);
  mockedDecline.mockResolvedValue(undefined);
  resetConnectionState();
  reportRealtimeJoined();
});

describe('InvitesScreen', () => {
  it('shows who invites, who else is invited and what the chat is saying', async () => {
    mockedList.mockResolvedValue([invite()]);

    await renderWithQuery(<InvitesScreen />);

    expect(await screen.findByText('Входящие')).toBeTruthy();
    expect(screen.getByText('Поход')).toBeTruthy();
    expect(screen.getByText('Марина зовёт вас в группу')).toBeTruthy();
    expect(screen.getByText(/Тоже позваны: Пётр/)).toBeTruthy();
    expect(screen.getByText(/берём палатку/)).toBeTruthy();
  });

  it('puts declined invites below the incoming ones', async () => {
    mockedList.mockResolvedValue([
      invite(),
      invite({
        chatId: 'chat-8',
        status: 'declined',
        chat: { ...group, id: 'chat-8', title: 'Старое' },
      }),
    ]);

    await renderWithQuery(<InvitesScreen />);

    await screen.findByText('Отклонённые');
    const headers = screen
      .getAllByText(/^(Входящие|Отклонённые)$/)
      .map((node) => node.props.children);
    expect(headers).toEqual(['Входящие', 'Отклонённые']);
  });

  it('accepts an incoming invite', async () => {
    mockedList.mockResolvedValue([invite()]);
    const user = userEvent.setup();

    await renderWithQuery(<InvitesScreen />);
    await user.press(await screen.findByText('Принять'));

    expect(mockedAccept).toHaveBeenCalledWith('chat-7');
  });

  it('declines an incoming invite', async () => {
    mockedList.mockResolvedValue([invite()]);
    const user = userEvent.setup();

    await renderWithQuery(<InvitesScreen />);
    await user.press(await screen.findByText('Отклонить'));

    expect(mockedDecline).toHaveBeenCalledWith('chat-7');
  });

  it('lets a declined invite be accepted but not declined again', async () => {
    mockedList.mockResolvedValue([invite({ status: 'declined' })]);
    const user = userEvent.setup();

    await renderWithQuery(<InvitesScreen />);
    await user.press(await screen.findByText('Принять'));

    expect(screen.queryByText('Отклонить')).toBeNull();
    expect(mockedAccept).toHaveBeenCalledWith('chat-7');
  });

  it('opens the chat to read it before deciding', async () => {
    mockedList.mockResolvedValue([invite()]);
    const user = userEvent.setup();

    await renderWithQuery(<InvitesScreen />);
    await user.press(await screen.findByLabelText('Открыть чат: Поход'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-7');
  });

  it('reports a failed answer in plain words', async () => {
    mockedList.mockResolvedValue([invite()]);
    mockedAccept.mockRejectedValue(new Error('Заявка не найдена'));
    const user = userEvent.setup();

    await renderWithQuery(<InvitesScreen />);
    await user.press(await screen.findByText('Принять'));

    expect(await screen.findByText('Не удалось принять заявку')).toBeTruthy();
  });

  it('says so when there are no invites', async () => {
    mockedList.mockResolvedValue([]);

    await renderWithQuery(<InvitesScreen />);

    expect(await screen.findByText('Заявок нет.')).toBeTruthy();
  });
});
