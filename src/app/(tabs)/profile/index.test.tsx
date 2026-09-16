import { fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import MyProfileScreen from './index';

import { getMyProfile } from '@/api/profile';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/api/profile', () => ({ getMyProfile: jest.fn() }));

const getMyProfileMock = getMyProfile as jest.Mock;
const pushMock = router.push as jest.Mock;

const profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
};

beforeEach(() => {
  jest.clearAllMocks();
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

    expect(pushMock).toHaveBeenCalledWith('/(tabs)/profile/edit');
  });

  it('offers a retry when loading fails and recovers on the second try', async () => {
    getMyProfileMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<MyProfileScreen />);
    await fireEvent.press(await findByText('Повторить'));

    expect(await findByText('Максим')).toBeTruthy();
  });
});
