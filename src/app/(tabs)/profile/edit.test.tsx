import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import EditProfileScreen from './edit';

import { getMyProfile, updateMyProfile, UsernameTakenError } from '@/api/profile';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/api/profile', () => {
  class UsernameTakenError extends Error {}

  return {
    getMyProfile: jest.fn(),
    updateMyProfile: jest.fn(),
    UsernameTakenError,
  };
});

const getMyProfileMock = getMyProfile as jest.Mock;
const updateMyProfileMock = updateMyProfile as jest.Mock;
const backMock = router.back as jest.Mock;

const profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
};

beforeEach(() => {
  jest.clearAllMocks();
  getMyProfileMock.mockResolvedValue(profile);
  updateMyProfileMock.mockResolvedValue(profile);
});

describe('EditProfileScreen', () => {
  it('prefills the form with the current profile', async () => {
    const { findByDisplayValue } = await renderWithQuery(<EditProfileScreen />);

    expect(await findByDisplayValue('maxim')).toBeTruthy();
    expect(await findByDisplayValue('Максим')).toBeTruthy();
    expect(await findByDisplayValue('Привет')).toBeTruthy();
  });

  it('starts with empty fields when the profile has no username yet', async () => {
    getMyProfileMock.mockResolvedValue({ ...profile, username: null, bio: null });

    const { findByPlaceholderText } = await renderWithQuery(<EditProfileScreen />);

    expect(await findByPlaceholderText('username')).toHaveDisplayValue('');
  });

  it('refuses to save an invalid username and does not hit the API', async () => {
    const { findByPlaceholderText, getByText } = await renderWithQuery(<EditProfileScreen />);

    await fireEvent.changeText(await findByPlaceholderText('username'), 'Nope!');
    await fireEvent.press(getByText('Сохранить'));

    expect(
      await waitFor(() =>
        getByText('Только латиница в нижнем регистре, цифры и _, начиная с буквы'),
      ),
    ).toBeTruthy();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it('saves the edited fields and goes back', async () => {
    const { findByPlaceholderText, getByText } = await renderWithQuery(<EditProfileScreen />);

    await fireEvent.changeText(await findByPlaceholderText('username'), 'new_handle');
    await fireEvent.press(getByText('Сохранить'));

    // Only the first argument is ours — TanStack appends a mutation context.
    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toEqual({
        username: 'new_handle',
        displayName: 'Максим',
        bio: 'Привет',
      }),
    );
    await waitFor(() => expect(backMock).toHaveBeenCalled());
  });

  it('reports a taken username on the field', async () => {
    updateMyProfileMock.mockRejectedValue(new UsernameTakenError('maxim'));

    const { findByText, getByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByText('Сохранить'));

    expect(await findByText('Это имя уже занято')).toBeTruthy();
    expect(getByText('Сохранить')).toBeTruthy();
  });

  it('reports any other failure without losing the form', async () => {
    updateMyProfileMock.mockRejectedValue(new Error('offline'));

    const { findByText, findByDisplayValue } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByText('Сохранить'));

    expect(await findByText('Не удалось сохранить. Попробуйте ещё раз.')).toBeTruthy();
    expect(await findByDisplayValue('maxim')).toBeTruthy();
  });
});
