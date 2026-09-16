import { fireEvent } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import UserProfileScreen from './[userId]';

import { getProfile } from '@/api/profile';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));

const getProfileMock = getProfile as jest.Mock;
const useLocalSearchParamsMock = useLocalSearchParams as jest.Mock;

const profile = {
  id: 'user-2',
  username: 'anna',
  displayName: 'Анна',
  avatarUrl: null,
  bio: 'Пишу о еде',
};

beforeEach(() => {
  jest.clearAllMocks();
  useLocalSearchParamsMock.mockReturnValue({ userId: 'user-2' });
});

describe('UserProfileScreen', () => {
  it('loads the profile named in the route', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, getByText } = await renderWithQuery(<UserProfileScreen />);

    expect(await findByText('Анна')).toBeTruthy();
    expect(getByText('@anna')).toBeTruthy();
    expect(getProfileMock).toHaveBeenCalledWith('user-2');
  });

  it('renders someone without a username without crashing', async () => {
    getProfileMock.mockResolvedValue({ ...profile, username: null, displayName: null });

    const { findByText } = await renderWithQuery(<UserProfileScreen />);

    expect(await findByText('Без имени')).toBeTruthy();
  });

  it('says the conversations are public — there is nothing to follow yet', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<UserProfileScreen />);
    await findByText('Анна');

    expect(
      queryByText('Переписка этого человека открыта — её можно читать из ленты и поиска.'),
    ).toBeTruthy();
    expect(queryByText('Подписаться')).toBeNull();
  });

  it('offers a retry when the profile fails to load', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<UserProfileScreen />);
    await fireEvent.press(await findByText('Повторить'));

    expect(await findByText('Анна')).toBeTruthy();
  });
});
