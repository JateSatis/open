import { fireEvent } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import UserProfileScreen from './[userId]';

import { getProfile } from '@/api/profile';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));

const getProfileMock = getProfile as jest.Mock;
const useLocalSearchParamsMock = useLocalSearchParams as jest.Mock;
const useSessionMock = useSession as jest.Mock;

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
