import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatInviteScreen } from '.';

import { getChat, type ChatSummary } from '@/api/chats';
import { getLastSeen } from '@/api/chatInfo';
import { inviteToChat, searchPeople } from '@/api/groups';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({ getChat: jest.fn() }));
jest.mock('@/api/chatInfo', () => ({ getLastSeen: jest.fn() }));
jest.mock('@/api/groups', () => ({ searchPeople: jest.fn(), inviteToChat: jest.fn() }));
jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => 'me' }));

const mockBack = jest.fn();

jest.mock('@/navigation', () => ({
  useRouteParams: () => ({ chatId: 'group-1' }), useRouter: () => ({ back: mockBack }) }));

const candidate = (id: string, displayName: string) => ({
  id,
  displayName,
  username: null,
  avatarUrl: null,
});

const group: ChatSummary = {
  id: 'group-1',
  kind: 'group',
  ownerId: 'me',
  description: null,
  avatarUrl: null,
  title: 'Команда',
  username: null,
  channel: null,
  participants: [
    { id: 'me', displayName: 'Я', avatarUrl: null, lastReadAt: '2026-10-14T10:00:00Z' },
    { id: 'anna', displayName: 'Анна', avatarUrl: null, lastReadAt: '2026-10-14T10:00:00Z' },
  ],
  waiting: [{ id: 'boris', displayName: 'Борис', avatarUrl: null }],
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
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getChat).mockResolvedValue(group);
  jest.mocked(getLastSeen).mockResolvedValue(new Map([['vera', { online: true, lastSeenAt: null }]]));
  jest.mocked(searchPeople).mockResolvedValue({
    items: [
      candidate('anna', 'Анна'),
      candidate('boris', 'Борис'),
      candidate('vera', 'Вера'),
      candidate('gleb', 'Глеб'),
    ],
    next: null,
  });
  jest.mocked(inviteToChat).mockResolvedValue(2);
});

describe('ChatInviteScreen', () => {
  it('marks members and the invited, and does not let them be picked', async () => {
    await renderWithQuery(<ChatInviteScreen />);

    expect(await screen.findByText('в группе')).toBeTruthy();
    expect(await screen.findByText('приглашён(а)')).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Анна' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Борис' }));

    expect(screen.getByTestId('invite-submit')).toBeDisabled();
  });

  it('shows who is online', async () => {
    await renderWithQuery(<ChatInviteScreen />);

    expect(await screen.findByText('в сети')).toBeTruthy();
  });

  it('invites the picked people and goes back', async () => {
    await renderWithQuery(<ChatInviteScreen />);

    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Вера' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Глеб' }));
    await fireEvent.press(screen.getByText('Пригласить (2)'));

    await waitFor(() => expect(inviteToChat).toHaveBeenCalledWith('group-1', ['vera', 'gleb']));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('searches people on the server as the query is typed', async () => {
    await renderWithQuery(<ChatInviteScreen />);

    await fireEvent.changeText(await screen.findByTestId('invite-search'), 'гле');

    await waitFor(() => expect(searchPeople).toHaveBeenCalledWith('гле', null, expect.anything()));
  });

  it('explains a failure in plain words and stays', async () => {
    jest.mocked(inviteToChat).mockRejectedValue(new Error('сбой'));
    await renderWithQuery(<ChatInviteScreen />);

    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Вера' }));
    await fireEvent.press(screen.getByText('Пригласить (1)'));

    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      'Не удалось пригласить. Попробуйте ещё раз.',
    );
    expect(mockBack).not.toHaveBeenCalled();
  });
});
