import { screen, userEvent, waitFor } from '@testing-library/react-native';

import MyFriendsScreen from './index';
import UserFriendsScreen from './[userId]';

import {
  acceptFriendRequest,
  declineFriendRequest,
  FriendsListHiddenError,
  listFriends,
  listIncomingFriendRequests,
  type FriendsPage,
} from '@/api/friends';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ userId: 'user-b' }),
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/friends', () => ({
  ...jest.requireActual('@/api/friends'),
  listFriends: jest.fn(),
  listIncomingFriendRequests: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
}));
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, isAuthenticated: true, isLoading: false }),
}));

const mocked = {
  listFriends: listFriends as jest.Mock,
  listIncoming: listIncomingFriendRequests as jest.Mock,
  accept: acceptFriendRequest as jest.Mock,
  decline: declineFriendRequest as jest.Mock,
};

function page(people: { id: string; name: string; username?: string }[]): FriendsPage {
  return {
    items: people.map((person) => ({
      id: person.id,
      displayName: person.name,
      username: person.username ?? null,
      avatarUrl: null,
      cursorAt: '2026-10-20T10:00:00Z',
      cursorId: `f-${person.id}`,
    })),
    next: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('свои друзья', () => {
  it('К4.1 входящая заявка — в разделе «Заявки», друзья — ниже', async () => {
    mocked.listIncoming.mockResolvedValue(page([{ id: 'user-a', name: 'Аня' }]));
    mocked.listFriends.mockResolvedValue(page([{ id: 'user-c', name: 'Вера', username: 'vera' }]));

    await renderWithQuery(<MyFriendsScreen />);

    expect(await screen.findByText('Заявки')).toBeTruthy();
    expect(screen.getByText('Аня')).toBeTruthy();
    expect(screen.getByText('Друзья')).toBeTruthy();
    expect(screen.getByText('Вера')).toBeTruthy();
    expect(screen.getByText('@vera')).toBeTruthy();
    expect(mocked.listFriends).toHaveBeenCalledWith('me', null);
  });

  it('К4.2 принять — заявка уходит, человек в друзьях', async () => {
    mocked.listIncoming.mockResolvedValue(page([{ id: 'user-a', name: 'Аня' }]));
    mocked.listFriends.mockResolvedValue(page([]));
    mocked.accept.mockImplementation(() => {
      mocked.listIncoming.mockResolvedValue(page([]));
      mocked.listFriends.mockResolvedValue(page([{ id: 'user-a', name: 'Аня' }]));

      return Promise.resolve('friends');
    });
    const user = userEvent.setup();

    await renderWithQuery(<MyFriendsScreen />);
    await user.press(await screen.findByLabelText('Принять заявку: Аня'));

    expect(mocked.accept).toHaveBeenCalledWith('user-a');
    await waitFor(() => expect(screen.queryByText('Заявки')).toBeNull());
    expect(screen.getByText('Аня')).toBeTruthy();
  });

  it('К4.3 отклонить — заявка исчезает из списка', async () => {
    mocked.listIncoming.mockResolvedValue(page([{ id: 'user-a', name: 'Аня' }]));
    mocked.listFriends.mockResolvedValue(page([]));
    mocked.decline.mockImplementation(() => {
      mocked.listIncoming.mockResolvedValue(page([]));

      return Promise.resolve('none');
    });
    const user = userEvent.setup();

    await renderWithQuery(<MyFriendsScreen />);
    await user.press(await screen.findByLabelText('Отклонить заявку: Аня'));

    expect(mocked.decline).toHaveBeenCalledWith('user-a');
    await waitFor(() => expect(screen.queryByText('Аня')).toBeNull());
  });

  it('пусто — подсказка, откуда добавлять', async () => {
    mocked.listIncoming.mockResolvedValue(page([]));
    mocked.listFriends.mockResolvedValue(page([]));

    await renderWithQuery(<MyFriendsScreen />);

    expect(await screen.findByText(/Пока ни одного друга/)).toBeTruthy();
    expect(screen.queryByText('Заявки')).toBeNull();
  });

  it('тап по человеку — его профиль', async () => {
    mocked.listIncoming.mockResolvedValue(page([]));
    mocked.listFriends.mockResolvedValue(page([{ id: 'user-c', name: 'Вера' }]));

    await renderWithQuery(<MyFriendsScreen />);
    await userEvent.setup().press(await screen.findByText('Вера'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/profile/[userId]',
      params: { userId: 'user-c' },
    });
  });
});

describe('друзья другого человека', () => {
  it('показывает его друзей', async () => {
    mocked.listFriends.mockResolvedValue(page([{ id: 'user-a', name: 'Аня' }]));

    await renderWithQuery(<UserFriendsScreen />);

    expect(await screen.findByText('Аня')).toBeTruthy();
    expect(mocked.listFriends).toHaveBeenCalledWith('user-b', null);
  });

  it('К5.3 список скрыт его настройкой — так и сказано, без пустого списка', async () => {
    mocked.listFriends.mockRejectedValue(new FriendsListHiddenError());

    await renderWithQuery(<UserFriendsScreen />);

    expect(await screen.findByText('Список друзей скрыт.')).toBeTruthy();
    expect(screen.queryByText(/Пока ни одного друга/)).toBeNull();
  });
});
