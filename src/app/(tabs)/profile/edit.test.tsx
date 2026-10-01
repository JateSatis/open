import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import EditProfileScreen from './edit';

import { getMyProfile, updateMyProfile, UsernameTakenError } from '@/api/profile';
import { pickAvatar, removeOwnAvatar, uploadAvatar } from '@/features/media';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
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

jest.mock('@/features/media', () => ({
  pickAvatar: jest.fn(),
  uploadAvatar: jest.fn(),
  removeOwnAvatar: jest.fn(),
}));

const pickAvatarMock = pickAvatar as jest.Mock;
const uploadAvatarMock = uploadAvatar as jest.Mock;
const removeOwnAvatarMock = removeOwnAvatar as jest.Mock;
const getMyProfileMock = getMyProfile as jest.Mock;
const updateMyProfileMock = updateMyProfile as jest.Mock;
const backMock = router.back as jest.Mock;

const profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
  status: 'в отпуске',
};

beforeEach(() => {
  jest.clearAllMocks();
  getMyProfileMock.mockResolvedValue(profile);
  updateMyProfileMock.mockResolvedValue(profile);
  removeOwnAvatarMock.mockResolvedValue(undefined);
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
        status: 'в отпуске',
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

  it('saves the status typed into its field', async () => {
    const { findByPlaceholderText, getByText } = await renderWithQuery(<EditProfileScreen />);

    await fireEvent.changeText(
      await findByPlaceholderText('Например: в отпуске'),
      '  на связи вечером ',
    );
    await fireEvent.press(getByText('Сохранить'));

    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toMatchObject({ status: 'на связи вечером' }),
    );
  });

  it('uploads a picked photo, points the profile at it and drops the old file', async () => {
    const old = { ...profile, avatarUrl: 'https://x/storage/v1/object/public/media/user-1/avatar/old.jpg' };
    getMyProfileMock.mockResolvedValue(old);
    pickAvatarMock.mockResolvedValue({ status: 'picked', avatar: { uri: 'file:///a.jpg', size: 512 } });
    uploadAvatarMock.mockResolvedValue('https://x/new.jpg');
    updateMyProfileMock.mockResolvedValue({ ...old, avatarUrl: 'https://x/new.jpg' });

    const { findByLabelText, getByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByLabelText('Изменить фото профиля'));
    await fireEvent.press(getByText('Выбрать из галереи'));

    await waitFor(() => expect(uploadAvatarMock).toHaveBeenCalledWith('file:///a.jpg', 'user-1'));
    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toEqual({ avatarUrl: 'https://x/new.jpg' }),
    );
    await waitFor(() =>
      expect(removeOwnAvatarMock).toHaveBeenCalledWith(old.avatarUrl, 'user-1'),
    );
    expect(pickAvatarMock).toHaveBeenCalledWith('library');
  });

  it('offers to remove the photo only when there is one', async () => {
    const { findByLabelText, getByText, queryByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByLabelText('Изменить фото профиля'));

    expect(getByText('Снять фото')).toBeTruthy();
    expect(queryByText('Удалить фото')).toBeNull();
  });

  it('removes the photo and clears it in the profile', async () => {
    const withAvatar = { ...profile, avatarUrl: 'https://x/a.jpg' };
    getMyProfileMock.mockResolvedValue(withAvatar);

    const { findByLabelText, getByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByLabelText('Изменить фото профиля'));
    await fireEvent.press(getByText('Удалить фото'));

    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toEqual({ avatarUrl: null }),
    );
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });

  it('explains a denied camera and does not upload anything', async () => {
    pickAvatarMock.mockResolvedValue({ status: 'denied' });

    const { findByLabelText, getByText, findByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByLabelText('Изменить фото профиля'));
    await fireEvent.press(getByText('Снять фото'));

    expect(await findByText('Нет доступа к камере. Разрешите его в настройках телефона.')).toBeTruthy();
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });
});
