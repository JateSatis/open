import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import InvitesScreen from './invites';

import type { ChatSummary } from '@/api/chats';
import { blockUser, reportUser } from '@/api/blocks';
import { acceptInvite, declineInvite, listInvites, type ChatInvite } from '@/api/invites';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
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

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/blocks', () => ({
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
  reportUser: jest.fn(),
  isBlockedByMe: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('@/api/invites', () => ({
  listInvites: jest.fn(),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));

const mockedList = listInvites as jest.MockedFunction<typeof listInvites>;
const mockedAccept = acceptInvite as jest.MockedFunction<typeof acceptInvite>;
const mockedDecline = declineInvite as jest.MockedFunction<typeof declineInvite>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedBlock = blockUser as jest.MockedFunction<typeof blockUser>;
const mockedReport = reportUser as jest.MockedFunction<typeof reportUser>;

const READ_AT = '2026-09-16T09:00:00Z';
const marina = { id: 'user-2', displayName: 'Марина', avatarUrl: null };

const group: ChatSummary = {
  id: 'chat-7',
  kind: 'group',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: 'Поход',
  participants: [{ ...marina, lastReadAt: READ_AT }],
  waiting: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null },
    { id: 'user-3', displayName: 'Пётр', avatarUrl: null },
  ],
  lastMessagePreview: 'берём палатку?',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  lastPopAt: null,
  lastActivityAt: '2026-09-16T10:00:00Z',
  listPosition: null,
  enteredAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 0,
  username: null,
  channel: null,
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
  mockedBlock.mockResolvedValue(undefined);
  mockedReport.mockResolvedValue(undefined);
  resetConfirmDialogQueue();
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

  describe('заявка на диалог', () => {
    const request = () =>
      invite({
        chatId: 'chat-9',
        chat: { ...group, id: 'chat-9', kind: 'direct', title: null, requestPending: true },
        recentMessages: [
          { ...invite().recentMessages[0], chatId: 'chat-9', text: 'Привет, познакомимся?' },
        ],
      });

    it('К1.4 показывает отправителя, текст заявки и все четыре действия', async () => {
      mockedList.mockResolvedValue([request()]);

      await renderWithQuery(<InvitesScreen />);

      expect(await screen.findByText('Марина хочет начать диалог')).toBeTruthy();
      expect(screen.getByText(/Привет, познакомимся/)).toBeTruthy();
      expect(screen.getByText('Принять')).toBeTruthy();
      expect(screen.getByText('Отклонить')).toBeTruthy();
      expect(screen.getByText('Заблокировать')).toBeTruthy();
      expect(screen.getByText('Пожаловаться')).toBeTruthy();
    });

    it('у приглашения в группу блокировки и жалобы на карточке нет', async () => {
      mockedList.mockResolvedValue([invite()]);

      await renderWithQuery(<InvitesScreen />);

      await screen.findByText('Поход');
      expect(screen.queryByText('Заблокировать')).toBeNull();
    });

    it('К2 «Заблокировать» — после подтверждения', async () => {
      mockedList.mockResolvedValue([request()]);
      const user = userEvent.setup();

      await renderWithQuery(
        <>
          <InvitesScreen />
          <ConfirmDialogHost />
        </>,
      );
      await user.press(await screen.findByText('Заблокировать'));
      expect(await screen.findByText('Заблокировать Марина?')).toBeTruthy();
      expect(mockedBlock).not.toHaveBeenCalled();
      // Последняя — кнопка диалога подтверждения, первая — на карточке.
      await user.press(screen.getAllByRole('button', { name: 'Заблокировать' }).at(-1)!);

      await waitFor(() => expect(mockedBlock).toHaveBeenCalledWith('user-2'));
    });

    it('К3.3 жалоба на заявку с причиной и блокировкой — «Жалоба отправлена»', async () => {
      mockedList.mockResolvedValue([request()]);
      const user = userEvent.setup();

      await renderWithQuery(<InvitesScreen />);
      await user.press(await screen.findByText('Пожаловаться'));
      await user.press(await screen.findByText('Спам'));
      await user.press(screen.getByTestId('report-send'));

      expect(await screen.findByText('Жалоба отправлена')).toBeTruthy();
      expect(mockedReport).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          reason: 'spam',
          chatId: 'chat-9',
          block: true,
        }),
      );
    });

    it('жалобу без причины не отправить', async () => {
      mockedList.mockResolvedValue([request()]);
      const user = userEvent.setup();

      await renderWithQuery(<InvitesScreen />);
      await user.press(await screen.findByText('Пожаловаться'));
      await user.press(await screen.findByTestId('report-send'));

      expect(mockedReport).not.toHaveBeenCalled();
    });
  });
});
