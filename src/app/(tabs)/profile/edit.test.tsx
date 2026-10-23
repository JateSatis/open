import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import EditProfileScreen from './edit';

import { getMyProfile, updateMyProfile, UsernameTakenError } from '@/api/profile';
import { isUsernameAvailable } from '@/api/usernames';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { removeOwnAvatar, uploadAvatar, type PreparedAvatar } from '@/features/media';
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

jest.mock('@/api/usernames', () => ({
  isUsernameAvailable: jest.fn(),
}));

jest.mock('@/features/media', () => ({
  uploadAvatar: jest.fn(),
  removeOwnAvatar: jest.fn(),
}));

// Шит аватарки — свой тест; здесь — что экран открывает его и что делает с итогом.
let sheetDone: ((avatar: Promise<PreparedAvatar>) => void) | null = null;

jest.mock('@/features/chats/MediaPickerSheet', () => ({ openMediaSheet: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet/MediaAvatarSheet', () => ({
  MediaAvatarSheet: ({ onDone }: { onDone: (avatar: Promise<PreparedAvatar>) => void }) => {
    sheetDone = onDone;
    return null;
  },
}));

const openMediaSheetMock = openMediaSheet as jest.Mock;
const uploadAvatarMock = uploadAvatar as jest.Mock;
const removeOwnAvatarMock = removeOwnAvatar as jest.Mock;
const getMyProfileMock = getMyProfile as jest.Mock;
const updateMyProfileMock = updateMyProfile as jest.Mock;
const backMock = router.back as jest.Mock;
const availableMock = isUsernameAvailable as jest.Mock;

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
  availableMock.mockResolvedValue(true);
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

  it('saves a cleared username as no username at all', async () => {
    const { findByPlaceholderText, getByText } = await renderWithQuery(<EditProfileScreen />);

    await fireEvent.changeText(await findByPlaceholderText('username'), '');
    await fireEvent.press(getByText('Сохранить'));

    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toMatchObject({ username: null }),
    );
    await waitFor(() => expect(backMock).toHaveBeenCalled());
  });

  it('refuses a username with a dot and explains why', async () => {
    const { findByPlaceholderText, getByText, findByText } = await renderWithQuery(
      <EditProfileScreen />,
    );

    await fireEvent.changeText(await findByPlaceholderText('username'), 'a.b');

    expect(await findByText('Точка в имени недопустима')).toBeTruthy();
    await fireEvent.press(getByText('Сохранить'));
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it('checks the name among people only and says when another person has it', async () => {
    availableMock.mockResolvedValue(false);

    const { findByPlaceholderText, findByText, getByText } = await renderWithQuery(
      <EditProfileScreen />,
    );
    await fireEvent.changeText(await findByPlaceholderText('username'), 'taken_name');

    expect(await findByText('Имя занято')).toBeTruthy();
    expect(availableMock).toHaveBeenCalledWith('profile', 'taken_name', undefined);
    await fireEvent.press(getByText('Сохранить'));
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it('does not ask about the name the profile already has', async () => {
    const { findByDisplayValue, queryByTestId } = await renderWithQuery(<EditProfileScreen />);

    await findByDisplayValue('maxim');

    expect(availableMock).not.toHaveBeenCalled();
    expect(queryByTestId('username-status')).toBeNull();
  });

  it('reports a taken username on the field', async () => {
    updateMyProfileMock.mockRejectedValue(new UsernameTakenError('maxim'));

    const { findByText, getByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByText('Сохранить'));

    expect(await findByText('Имя занято')).toBeTruthy();
    expect(getByText('Сохранить')).toBeTruthy();
  });

  it('reports any other failure without losing the form', async () => {
    updateMyProfileMock.mockRejectedValue(new Error('offline'));

    const { findByText, findByDisplayValue } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByText('Сохранить'));

    expect(await findByText('Не удалось сохранить. Попробуйте ещё раз.')).toBeTruthy();
    expect(await findByDisplayValue('maxim')).toBeTruthy();
  });

  it('К3.5 «О себе» с адресом — сначала лист «Это увидят все», «Изменить» не сохраняет', async () => {
    const { findByPlaceholderText, getByText, findByText, queryByText } = await renderWithQuery(
      <EditProfileScreen />,
    );

    await fireEvent.changeText(
      await findByPlaceholderText('Пара строк о себе'),
      'живу на Ленина 5, кв 12',
    );
    await fireEvent.press(getByText('Сохранить'));

    expect(await findByText('Это увидят все')).toBeTruthy();
    expect(getByText('Ленина 5, кв 12')).toBeTruthy();
    // У «О себе» скрытого текста нет — только поправить или сохранить как есть.
    expect(queryByText('Скрыть найденное от зрителей')).toBeNull();

    await fireEvent.press(getByText('Изменить'));
    expect(updateMyProfileMock).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Сохранить'));
    await fireEvent.press(await findByText('Сохранить как есть'));

    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toMatchObject({
        bio: 'живу на Ленина 5, кв 12',
      }),
    );
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

  it('opens the avatar sheet straight from the photo and from the link, without a menu', async () => {
    const { findByLabelText, getByText, queryByText } = await renderWithQuery(
      <EditProfileScreen />,
    );

    await fireEvent.press(await findByLabelText('Изменить фото профиля'));
    expect(openMediaSheetMock).toHaveBeenLastCalledWith('avatar:profile');

    await fireEvent.press(getByText('Добавить фото'));
    expect(openMediaSheetMock).toHaveBeenCalledTimes(2);
    expect(queryByText('Выбрать из галереи')).toBeNull();
    expect(queryByText('Снять фото')).toBeNull();
  });

  it('points to where the photo visibility is set, not promising it is public', async () => {
    const { findByText } = await renderWithQuery(<EditProfileScreen />);

    expect(await findByText('Кому видно фото — в «Конфиденциальности»')).toBeTruthy();
  });

  it('uploads the photo from the sheet, points the profile at it and drops the old file', async () => {
    const old = {
      ...profile,
      avatarUrl: 'https://x/storage/v1/object/public/media/user-1/avatar/old.jpg',
    };
    getMyProfileMock.mockResolvedValue(old);
    uploadAvatarMock.mockResolvedValue('https://x/new.jpg');
    updateMyProfileMock.mockResolvedValue({ ...old, avatarUrl: 'https://x/new.jpg' });

    const { findByText } = await renderWithQuery(<EditProfileScreen />);
    await findByText('Изменить фото');
    await act(async () => sheetDone?.(Promise.resolve({ uri: 'file:///a.jpg', size: 512 })));

    await waitFor(() => expect(uploadAvatarMock).toHaveBeenCalledWith('file:///a.jpg', 'user-1'));
    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toEqual({ avatarUrl: 'https://x/new.jpg' }),
    );
    await waitFor(() => expect(removeOwnAvatarMock).toHaveBeenCalledWith(old.avatarUrl, 'user-1'));
  });

  it('explains a photo that could not be prepared and uploads nothing', async () => {
    const { findByText } = await renderWithQuery(<EditProfileScreen />);
    await findByText('Добавить фото');
    await act(async () => sheetDone?.(Promise.reject(new Error('decode'))));

    expect(await findByText('Не удалось открыть фото. Попробуйте ещё раз.')).toBeTruthy();
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });

  it('explains a failed upload and keeps the old photo', async () => {
    uploadAvatarMock.mockRejectedValue(new Error('Network request failed'));

    const { findByText } = await renderWithQuery(<EditProfileScreen />);
    await findByText('Добавить фото');
    await act(async () => sheetDone?.(Promise.resolve({ uri: 'file:///a.jpg', size: 512 })));

    expect(
      await findByText('Не удалось сохранить фото. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it('offers to remove the photo only when there is one', async () => {
    const { findByText, queryByText } = await renderWithQuery(<EditProfileScreen />);

    expect(await findByText('Добавить фото')).toBeTruthy();
    expect(queryByText('Удалить фото')).toBeNull();
  });

  it('removes the photo and clears it in the profile', async () => {
    const withAvatar = { ...profile, avatarUrl: 'https://x/a.jpg' };
    getMyProfileMock.mockResolvedValue(withAvatar);

    const { findByText } = await renderWithQuery(<EditProfileScreen />);
    await fireEvent.press(await findByText('Удалить фото'));

    await waitFor(() =>
      expect(updateMyProfileMock.mock.calls[0]?.[0]).toEqual({ avatarUrl: null }),
    );
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });
});
