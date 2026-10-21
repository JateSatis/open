import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import UserProfileScreen from './[userId]';

import {
  acceptFriendRequest,
  cancelFriendRequest,
  FriendRequestLimitError,
  getFriendsSummary,
  getFriendshipStatus,
  removeFriend,
  sendFriendRequest,
} from '@/api/friends';
import { getProfile } from '@/api/profile';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true }),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/friends', () => ({
  ...jest.requireActual('@/api/friends'),
  getFriendshipStatus: jest.fn(),
  getFriendsSummary: jest.fn(),
  sendFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  removeFriend: jest.fn(),
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));

// Верх профиля — страница информации: цвет плашки из фото (Skia) и просмотр фото.
jest.mock('@shopify/react-native-skia', () => ({
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

jest.mock('@/features/media', () => ({ MediaViewer: () => null }));

const getProfileMock = getProfile as jest.Mock;
const useLocalSearchParamsMock = useLocalSearchParams as jest.Mock;
const useSessionMock = useSession as jest.Mock;
const friends = {
  status: getFriendshipStatus as jest.Mock,
  summary: getFriendsSummary as jest.Mock,
  send: sendFriendRequest as jest.Mock,
  cancel: cancelFriendRequest as jest.Mock,
  accept: acceptFriendRequest as jest.Mock,
  remove: removeFriend as jest.Mock,
};

const profile = {
  id: 'user-2',
  username: 'anna',
  displayName: 'Анна',
  avatarUrl: null,
  bio: 'Пишу о еде',
  status: 'в отпуске до понедельника',
};

beforeEach(() => {
  jest.clearAllMocks();
  useLocalSearchParamsMock.mockReturnValue({ userId: 'user-2' });
  useSessionMock.mockReturnValue({ session: { user: { id: 'user-1' } } });
  friends.status.mockResolvedValue('none');
  friends.summary.mockResolvedValue({ listVisible: true, friendsCount: 3, incomingCount: null });
  resetConfirmDialogQueue();
});

describe('UserProfileScreen', () => {
  it('loads the profile named in the route with its status and bio', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, getByText } = await renderWithQuery(<UserProfileScreen />);

    expect(await findByText('Анна')).toBeTruthy();
    expect(getByText('@anna')).toBeTruthy();
    expect(getByText('в отпуске до понедельника')).toBeTruthy();
    expect(getByText('Пишу о еде')).toBeTruthy();
    expect(getProfileMock).toHaveBeenCalledWith('user-2');
  });

  it('renders someone without a username without crashing', async () => {
    getProfileMock.mockResolvedValue({ ...profile, username: null, displayName: null });

    const { findByText } = await renderWithQuery(<UserProfileScreen />);

    expect(await findByText('Без имени')).toBeTruthy();
  });

  it('opens a new chat with this person already picked', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<UserProfileScreen />);
    await fireEvent.press(await findByText('Написать'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chats/new', params: { with: 'user-2' } });
  });

  it('opens their dialogs in the same stack, so «back» returns to the profile', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<UserProfileScreen />);
    await fireEvent.press(await findByText('Диалоги'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/profile/dialogs/[userId]',
      params: { userId: 'user-2' },
    });
  });

  it('goes back from the arrow on the photo', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByTestId } = await renderWithQuery(<UserProfileScreen />);
    await fireEvent.press(await findByTestId('info-back'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('offers no follow button — there are no subscriptions', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<UserProfileScreen />);
    await findByText('Анна');

    expect(queryByText('Подписаться')).toBeNull();
  });

  it('does not offer to write to yourself', async () => {
    useSessionMock.mockReturnValue({ session: { user: { id: 'user-2' } } });
    getProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<UserProfileScreen />);
    await findByText('Анна');

    expect(queryByText('Написать')).toBeNull();
  });

  it('offers a retry when the profile fails to load', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<UserProfileScreen />);
    await fireEvent.press(await findByText('Повторить'));

    expect(await findByText('Анна')).toBeTruthy();
  });
});

describe('UserProfileScreen — друзья', () => {
  /** Действие меняет пару на сервере — и статус, перечитанный после него, тоже. */
  function serverAnswers(action: jest.Mock, status: string) {
    action.mockImplementation(() => {
      friends.status.mockResolvedValue(status);

      return Promise.resolve(status);
    });
  }

  function renderProfile() {
    getProfileMock.mockResolvedValue(profile);

    return renderWithQuery(
      <>
        <UserProfileScreen />
        <ConfirmDialogHost />
      </>,
    );
  }

  it('К4.1 «Добавить в друзья» отправляет заявку, кнопка — «Заявка отправлена»', async () => {
    serverAnswers(friends.send, 'outgoing');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Добавить в друзья'));

    expect(friends.send).toHaveBeenCalledWith('user-2');
    expect(await screen.findByText('Заявка отправлена')).toBeTruthy();
  });

  it('К4.3 отклонённая заявка выглядит так же — «Заявка отправлена», её можно отменить', async () => {
    friends.status.mockResolvedValue('outgoing');
    serverAnswers(friends.cancel, 'none');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Заявка отправлена'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить заявку' }));

    await waitFor(() => expect(friends.cancel).toHaveBeenCalledWith('user-2'));
    expect(await screen.findByText('Добавить в друзья')).toBeTruthy();
  });

  it('К4.2 встречная заявка — «Принять заявку», после неё «Вы друзья»', async () => {
    friends.status.mockResolvedValue('incoming');
    serverAnswers(friends.accept, 'friends');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Принять заявку'));

    expect(friends.accept).toHaveBeenCalledWith('user-2');
    expect(await screen.findByText('Вы друзья')).toBeTruthy();
  });

  it('К4.5 «Вы друзья» → «Удалить из друзей» → снова «Добавить в друзья»', async () => {
    friends.status.mockResolvedValue('friends');
    serverAnswers(friends.remove, 'none');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Вы друзья'));
    await fireEvent.press(await screen.findByText('Удалить из друзей'));

    expect(friends.remove).toHaveBeenCalledWith('user-2');
    expect(await screen.findByText('Добавить в друзья')).toBeTruthy();
  });

  it('лимит заявок — понятный текст, а не сырой ответ', async () => {
    friends.send.mockRejectedValue(new FriendRequestLimitError());
    await renderProfile();

    await fireEvent.press(await screen.findByText('Добавить в друзья'));

    expect(
      await screen.findByText('Слишком много заявок в друзья. Попробуйте позже.'),
    ).toBeTruthy();
  });

  it('строка «Друзья» ведёт к его списку в том же стеке', async () => {
    await renderProfile();

    await fireEvent.press(await screen.findByTestId('profile-friends'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/profile/friends/[userId]',
      params: { userId: 'user-2' },
    });
  });

  it('К5.3 список скрыт его настройкой — строки «Друзья» нет', async () => {
    friends.summary.mockResolvedValue({
      listVisible: false,
      friendsCount: null,
      incomingCount: null,
    });
    await renderProfile();
    await screen.findByText('Добавить в друзья');

    expect(screen.queryByTestId('profile-friends')).toBeNull();
  });

  it('у себя кнопки дружбы нет', async () => {
    useSessionMock.mockReturnValue({ session: { user: { id: 'user-2' } } });
    friends.status.mockResolvedValue('self');
    await renderProfile();
    await screen.findByText('Анна');

    expect(screen.queryByTestId('friend-button')).toBeNull();
  });
});
