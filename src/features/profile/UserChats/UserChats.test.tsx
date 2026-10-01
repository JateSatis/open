import { fireEvent, screen } from '@testing-library/react-native';

import { UserChats } from '.';

import { listChatsOf, type ChatSummary } from '@/api/chats';
import { getProfile } from '@/api/profile';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));
jest.mock('@/api/chats', () => ({ listChatsOf: jest.fn() }));

const listChatsOfMock = listChatsOf as jest.MockedFunction<typeof listChatsOf>;

const anna = { id: 'user-2', displayName: 'Анна', avatarUrl: null };
const oleg = { id: 'user-3', displayName: 'Олег', avatarUrl: null };
const me = { id: 'user-1', displayName: 'Я', avatarUrl: null };

function chat(id: string, overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id,
    kind: 'direct',
    title: null,
    participants: [],
    waiting: [],
    lastMessagePreview: 'привет',
    lastMessageAt: '2026-10-01T10:00:00Z',
    lastMessageAuthorId: 'user-3',
    hasUnread: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getProfile as jest.Mock).mockResolvedValue({ ...anna, username: 'anna', bio: null, status: null });
});

describe('UserChats', () => {
  it('shows a direct chat titled by HER counterpart, not by me', async () => {
    listChatsOfMock.mockResolvedValue({
      items: [
        chat('c1', {
          participants: [
            { ...anna, lastReadAt: '2026-10-01T09:00:00Z' },
            { ...oleg, lastReadAt: '2026-10-01T10:00:00Z' },
          ],
          hasUnread: true,
        }),
        chat('c2', {
          kind: 'group',
          title: 'Кухня',
          participants: [
            { ...anna, lastReadAt: '2026-10-01T10:00:00Z' },
            { ...me, lastReadAt: '2026-10-01T10:00:00Z' },
          ],
        }),
      ],
      nextCursor: null,
      nextPage: null,
    });

    await renderWithQuery(<UserChats userId="user-2" />);

    expect(await screen.findByText('Олег')).toBeTruthy();
    expect(screen.getByText('Кухня')).toBeTruthy();
    // Непрочитанное — её, а не моё: только у первого чата.
    expect(screen.getAllByLabelText('Есть непрочитанные сообщения')).toHaveLength(1);
    expect(listChatsOfMock).toHaveBeenCalledWith('user-2', 0);
  });

  it('opens a chat on tap — as a visitor, if I am not in it', async () => {
    listChatsOfMock.mockResolvedValue({
      items: [chat('c1', { participants: [{ ...anna, lastReadAt: '' }, { ...oleg, lastReadAt: '' }] })],
      nextCursor: null,
      nextPage: null,
    });

    await renderWithQuery(<UserChats userId="user-2" />);
    await fireEvent.press(await screen.findByText('Олег'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chats/[chatId]', params: { chatId: 'c1' } });
  });

  it('says so honestly when there are no dialogs', async () => {
    listChatsOfMock.mockResolvedValue({ items: [], nextCursor: null, nextPage: null });

    await renderWithQuery(<UserChats userId="user-2" />);

    expect(await screen.findByText('Пока ни одного диалога.')).toBeTruthy();
  });
});
