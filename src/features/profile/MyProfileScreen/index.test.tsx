import { fireEvent } from '@testing-library/react-native';
import { router } from '@/navigation';

import { MyProfileScreen } from './index';

import { getFriendsSummary } from '@/api/friends';
import { getMyProfile } from '@/api/profile';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  router: { push: jest.fn(), back: jest.fn() },
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@/api/profile', () => ({ getMyProfile: jest.fn() }));
jest.mock('@/api/friends', () => ({ getFriendsSummary: jest.fn() }));
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({
    session: { user: { id: 'user-1' } },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Верх профиля — страница информации: цвет плашки из фото (Skia) и просмотр фото.
jest.mock('@shopify/react-native-skia', () => ({
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

jest.mock('@/features/media', () => ({ MediaViewer: () => null }));

const getMyProfileMock = getMyProfile as jest.Mock;
const pushMock = router.push as jest.Mock;
const getFriendsSummaryMock = getFriendsSummary as jest.Mock;

const profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
};

beforeEach(() => {
  jest.clearAllMocks();
  getFriendsSummaryMock.mockResolvedValue({ listVisible: true, friendsCount: 2, incomingCount: 0 });
});

describe('MyProfileScreen', () => {
  it('shows a spinner while the profile is loading', async () => {
    getMyProfileMock.mockReturnValue(new Promise(() => {}));

    const { getByLabelText } = await renderWithQuery(<MyProfileScreen />);

    expect(getByLabelText('Загрузка профиля')).toBeTruthy();
  });

  it('shows the loaded profile', async () => {
    getMyProfileMock.mockResolvedValue(profile);

    const { findByText, getByText } = await renderWithQuery(<MyProfileScreen />);

    expect(await findByText('Максим')).toBeTruthy();
    expect(getByText('@maxim')).toBeTruthy();
    expect(getByText('Привет')).toBeTruthy();
  });

  it('prompts for a username when the profile has none yet', async () => {
    getMyProfileMock.mockResolvedValue({ ...profile, username: null });

    const { findByText } = await renderWithQuery(<MyProfileScreen />);

    expect(await findByText('Имя пользователя не задано')).toBeTruthy();
  });

  it('hides the prompt once a username is set', async () => {
    getMyProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<MyProfileScreen />);
    await findByText('Максим');

    expect(queryByText('Имя пользователя не задано')).toBeNull();
  });

  it('opens the edit screen from the edit button', async () => {
    getMyProfileMock.mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<MyProfileScreen />);
    await fireEvent.press(await findByText('Редактировать профиль'));

    expect(pushMock).toHaveBeenCalledWith({ name: 'EditProfile' });
  });

  it('opens «Аккаунт» from the gear on the photo — there is no header', async () => {
    getMyProfileMock.mockResolvedValue(profile);

    const { findByLabelText } = await renderWithQuery(<MyProfileScreen />);
    await fireEvent.press(await findByLabelText('Аккаунт'));

    expect(pushMock).toHaveBeenCalledWith({ name: 'Account' });
  });

  it('offers a retry when loading fails and recovers on the second try', async () => {
    getMyProfileMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<MyProfileScreen />);
    await fireEvent.press(await findByText('Повторить'));

    expect(await findByText('Максим')).toBeTruthy();
  });
});

describe('MyProfileScreen — друзья', () => {
  it('К4.1 строка «Друзья» показывает входящие заявки и ведёт к своему списку', async () => {
    getMyProfileMock.mockResolvedValue(profile);
    getFriendsSummaryMock.mockResolvedValue({ listVisible: true, friendsCount: 2, incomingCount: 1 });

    const { findByTestId, getByLabelText } = await renderWithQuery(<MyProfileScreen />);

    expect(await findByTestId('profile-friends-requests')).toBeTruthy();
    expect(getByLabelText('Друзья, новых заявок: 1')).toBeTruthy();

    await fireEvent.press(await findByTestId('profile-friends'));
    expect(pushMock).toHaveBeenCalledWith({ name: 'MyFriends' });
  });

  it('без заявок — только число друзей', async () => {
    getMyProfileMock.mockResolvedValue(profile);

    const { findByLabelText, queryByTestId } = await renderWithQuery(<MyProfileScreen />);

    expect(await findByLabelText('Друзья: 2')).toBeTruthy();
    expect(queryByTestId('profile-friends-requests')).toBeNull();
  });
});
