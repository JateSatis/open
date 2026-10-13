import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatInfoScreen } from '.';

import { getChat, setChatAvatar, setChatUsername, type ChatSummary } from '@/api/chats';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import {
  removeOwnGroupAvatar,
  removeUploadedMedia,
  uploadGroupAvatar,
  type PreparedAvatar,
} from '@/features/media';
import { isUsernameAvailable } from '@/api/usernames';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/chats', () => {
  class MockTaken extends Error {}

  return {
    getChat: jest.fn(),
    setChatUsername: jest.fn(),
    setChatAvatar: jest.fn(),
    ChatUsernameTakenError: MockTaken,
  };
});

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));

jest.mock('@/features/media', () => ({
  uploadGroupAvatar: jest.fn(),
  removeUploadedMedia: jest.fn(),
  removeOwnGroupAvatar: jest.fn(),
}));

// Шит аватарки — свой тест; здесь — кто его открывает и что делает с итогом.
// «Готово» шита — кнопка мока: нажатие идёт через act, как у живого пальца.
jest.mock('@/features/chats/MediaPickerSheet', () => ({ openMediaSheet: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet/MediaAvatarSheet', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    MediaAvatarSheet: ({ onDone }: { onDone: (avatar: Promise<PreparedAvatar>) => void }) => (
      <Pressable
        testID="avatar-sheet-done"
        onPress={() => onDone(Promise.resolve({ uri: 'file:///g.jpg', size: 512 }))}
      />
    ),
  };
});

let mockUserId = 'me';

jest.mock('@/features/chats/useCurrentUserId', () => ({
  useCurrentUserId: () => mockUserId,
}));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedSet = setChatUsername as jest.MockedFunction<typeof setChatUsername>;
const mockedAvailable = isUsernameAvailable as jest.MockedFunction<typeof isUsernameAvailable>;
const mockedSetAvatar = setChatAvatar as jest.MockedFunction<typeof setChatAvatar>;
const mockedUpload = uploadGroupAvatar as jest.MockedFunction<typeof uploadGroupAvatar>;

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarUrl: null,
  lastReadAt: '2026-10-12T10:00:00Z',
});

const group: ChatSummary = {
  id: 'group-1',
  kind: 'group',
  avatarUrl: null,
  title: 'Команда',
  username: null,
  channel: null,
  participants: [person('me', 'Я'), person('anna', 'Анна'), person('oleg', 'Олег')],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  lastPopAt: null,
  lastActivityAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'me';
  mockedGetChat.mockResolvedValue(group);
  mockedAvailable.mockResolvedValue(true);
  mockedSet.mockResolvedValue(undefined);
  mockedSetAvatar.mockResolvedValue(undefined);
  mockedUpload.mockResolvedValue({
    url: 'https://x/media/me/group-avatar/new.jpg',
    path: 'me/group-avatar/new.jpg',
  });
});

describe('ChatInfoScreen', () => {
  it('shows the title, the member count and an empty username field to a member', async () => {
    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);

    expect(await screen.findByText('Команда')).toBeTruthy();
    expect(screen.getByText('3 участника')).toBeTruthy();
    expect(screen.getByTestId('chat-username')).toHaveDisplayValue('');
    expect(screen.getByTestId('chat-username-suffix')).toHaveTextContent('.di');
    expect(screen.queryByTestId('chat-info-username')).toBeNull();
  });

  it('lets a member set a free username and shows it as @name.di', async () => {
    mockedGetChat.mockResolvedValueOnce(group).mockResolvedValue({ ...group, username: 'team' });

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'team');

    expect(await screen.findByText('Имя свободно')).toBeTruthy();
    expect(mockedAvailable).toHaveBeenCalledWith('group', 'team', 'group-1');

    await fireEvent.press(screen.getByTestId('chat-username-save'));

    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith('group-1', 'team'));
    expect(await screen.findByTestId('chat-info-username')).toHaveTextContent('@team.di');
  });

  it('lets a member clear the username', async () => {
    mockedGetChat.mockResolvedValueOnce({ ...group, username: 'team' }).mockResolvedValue(group);

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
    expect(await screen.findByTestId('chat-info-username')).toHaveTextContent('@team.di');

    await fireEvent.changeText(screen.getByTestId('chat-username'), '');
    await fireEvent.press(screen.getByTestId('chat-username-save'));

    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith('group-1', null));
    await waitFor(() => expect(screen.queryByTestId('chat-info-username')).toBeNull());
  });

  it('refuses a name with a dot', async () => {
    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'a.b');

    expect(await screen.findByText('Точка в имени недопустима')).toBeTruthy();
    expect(screen.getByTestId('chat-username-save')).toBeDisabled();
  });

  it('says the name is taken by another group and does not save', async () => {
    mockedAvailable.mockResolvedValue(false);

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'busy');

    expect(await screen.findByText('Имя занято')).toBeTruthy();
    expect(screen.getByTestId('chat-username-save')).toBeDisabled();
  });

  it('explains a network failure in plain words', async () => {
    mockedSet.mockRejectedValue(new TypeError('Network request failed'));

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'team');
    await screen.findByText('Имя свободно');
    await fireEvent.press(screen.getByTestId('chat-username-save'));

    expect(
      await screen.findByText('Нет связи. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
  });

  it('shows an outsider the username as text, without a field or a button', async () => {
    mockUserId = 'stranger';
    mockedGetChat.mockResolvedValue({ ...group, username: 'team' });

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);

    expect(await screen.findByTestId('chat-info-username')).toHaveTextContent('@team.di');
    expect(screen.queryByTestId('chat-username')).toBeNull();
    expect(screen.queryByTestId('chat-username-save')).toBeNull();
  });

  it('shows an outsider no @ line when the group has no username', async () => {
    mockUserId = 'stranger';

    await renderWithQuery(<ChatInfoScreen chatId="group-1" />);

    expect(await screen.findByText('Команда')).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.queryByTestId('chat-username')).toBeNull();
  });

  describe('group photo', () => {
    const photo = 'https://x/media/anna/group-avatar/old.jpg';

    it('a member adds a photo through the avatar sheet', async () => {
      mockedGetChat
        .mockResolvedValueOnce(group)
        .mockResolvedValue({ ...group, avatarUrl: 'https://x/media/me/group-avatar/new.jpg' });

      await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
      await fireEvent.press(await screen.findByText('Добавить фото'));

      expect(openMediaSheet).toHaveBeenCalledWith('avatar:group');
      expect(screen.queryByText('Удалить фото')).toBeNull();

      await fireEvent.press(screen.getByTestId('avatar-sheet-done'));

      await waitFor(() =>
        expect(mockedSetAvatar).toHaveBeenCalledWith(
          'group-1',
          'https://x/media/me/group-avatar/new.jpg',
        ),
      );
      expect(mockedUpload).toHaveBeenCalledWith('file:///g.jpg', 'me');
      expect(await screen.findByText('Изменить фото')).toBeTruthy();
      expect(screen.getByText('Удалить фото')).toBeTruthy();
      // Чат перечитан после смены — дальше на экране ничего не меняется.
      await waitFor(() => expect(mockedGetChat).toHaveBeenCalledTimes(2));
    });

    it('tapping the photo opens the sheet straight away', async () => {
      mockedGetChat.mockResolvedValue({ ...group, avatarUrl: photo });

      await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
      await fireEvent.press(await screen.findByLabelText('Изменить фото группы'));

      expect(openMediaSheet).toHaveBeenCalledWith('avatar:group');
    });

    it('a member removes the photo; a file someone else uploaded is left to them', async () => {
      mockedGetChat
        .mockResolvedValueOnce({ ...group, avatarUrl: photo })
        .mockResolvedValue(group);

      await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
      await fireEvent.press(await screen.findByText('Удалить фото'));

      await waitFor(() => expect(mockedSetAvatar).toHaveBeenCalledWith('group-1', null));
      expect(removeOwnGroupAvatar).toHaveBeenCalledWith(photo, 'me');
      expect(await screen.findByText('Добавить фото')).toBeTruthy();
      expect(screen.queryByText('Удалить фото')).toBeNull();
    });

    it('a refused photo is explained, the old one stays and the upload is cleaned up', async () => {
      mockedGetChat.mockResolvedValue({ ...group, avatarUrl: photo });
      mockedSetAvatar.mockRejectedValue(new TypeError('Network request failed'));

      await renderWithQuery(<ChatInfoScreen chatId="group-1" />);
      await screen.findByText('Изменить фото');
      await fireEvent.press(screen.getByTestId('avatar-sheet-done'));

      expect(
        await screen.findByText('Нет связи. Проверьте интернет и попробуйте ещё раз.'),
      ).toBeTruthy();
      expect(removeUploadedMedia).toHaveBeenCalledWith('me/group-avatar/new.jpg');
      expect(removeOwnGroupAvatar).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Сохранение фото')).toBeNull();
      expect(screen.getByText('Удалить фото')).toBeTruthy();
    });

    it('an outsider sees the photo but cannot change it', async () => {
      mockUserId = 'stranger';
      mockedGetChat.mockResolvedValue({ ...group, avatarUrl: photo });

      await renderWithQuery(<ChatInfoScreen chatId="group-1" />);

      expect(await screen.findByText('Команда')).toBeTruthy();
      expect(screen.queryByText('Изменить фото')).toBeNull();
      expect(screen.queryByText('Добавить фото')).toBeNull();
      expect(screen.queryByText('Удалить фото')).toBeNull();
      expect(screen.queryByLabelText('Изменить фото группы')).toBeNull();
      expect(openMediaSheet).not.toHaveBeenCalled();
    });
  });
});
