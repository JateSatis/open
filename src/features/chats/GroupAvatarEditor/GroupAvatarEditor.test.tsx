import { fireEvent, screen } from '@testing-library/react-native';

import { GroupAvatarEditor } from '.';

import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import type { PreparedAvatar } from '@/features/media';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/chats', () => ({ setChatAvatar: jest.fn() }));
jest.mock('@/features/media', () => ({
  uploadGroupAvatar: jest.fn(),
  removeUploadedMedia: jest.fn(),
  removeOwnGroupAvatar: jest.fn(),
}));

// Шит аватарки — свой тест; «Готово» шита — кнопка мока, фото в ней не готовится.
jest.mock('@/features/chats/MediaPickerSheet', () => ({ openMediaSheet: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet/MediaAvatarSheet', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    MediaAvatarSheet: ({ onDone }: { onDone: (avatar: Promise<PreparedAvatar>) => void }) => (
      <Pressable
        testID="avatar-sheet-done"
        onPress={() => onDone(Promise.reject(new Error('decode')))}
      />
    ),
  };
});

function renderEditor(avatarUrl: string | null) {
  return renderWithQuery(
    <GroupAvatarEditor chatId="group-1" userId="me" avatarUrl={avatarUrl} name="Поход" size={96} />,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('GroupAvatarEditor', () => {
  it('offers to add a photo when there is none, and nothing to delete', async () => {
    await renderEditor(null);

    expect(screen.getByText('Добавить фото')).toBeTruthy();
    expect(screen.queryByText('Удалить фото')).toBeNull();
  });

  it('opens the group avatar sheet from the photo and from the link', async () => {
    await renderEditor('https://x/g.jpg');

    await fireEvent.press(screen.getByLabelText('Изменить фото группы'));
    await fireEvent.press(screen.getByText('Изменить фото'));

    expect(openMediaSheet).toHaveBeenNthCalledWith(1, 'avatar:group');
    expect(openMediaSheet).toHaveBeenNthCalledWith(2, 'avatar:group');
    expect(screen.getByText('Удалить фото')).toBeTruthy();
  });

  it('explains a photo that could not be prepared and clears it on the next try', async () => {
    await renderEditor(null);

    await fireEvent.press(screen.getByTestId('avatar-sheet-done'));
    expect(await screen.findByText('Не удалось открыть фото. Попробуйте ещё раз.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Добавить фото'));
    expect(screen.queryByText('Не удалось открыть фото. Попробуйте ещё раз.')).toBeNull();
  });
});
