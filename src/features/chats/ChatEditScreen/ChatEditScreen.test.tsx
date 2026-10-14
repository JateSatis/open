import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ChatEditScreen } from '.';

import { getChatInfoSummary, setChatTitle } from '@/api/chatInfo';
import { setChatDescription } from '@/api/groups';
import { getChat, setChatAvatar, setChatUsername, type ChatSummary } from '@/api/chats';
import { isUsernameAvailable } from '@/api/usernames';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import {
  removeOwnGroupAvatar,
  removeUploadedMedia,
  uploadGroupAvatar,
  type PreparedAvatar,
} from '@/features/media';
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

jest.mock('@/api/chatInfo', () => ({
  getChatInfoSummary: jest.fn(),
  setChatTitle: jest.fn(),
}));

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));
jest.mock('@/api/groups', () => ({ setChatDescription: jest.fn() }));

jest.mock('@/features/media', () => ({
  uploadGroupAvatar: jest.fn(),
  removeUploadedMedia: jest.fn(),
  removeOwnGroupAvatar: jest.fn(),
}));

const mockBack = jest.fn();

// Галочка живёт в шапке стека — мок рисует её прямо на экране.
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight ? options.headerRight() : null,
  },
}));

// Шит аватарки — свой тест; здесь — кто его открывает и что делает с итогом.
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
const mockedSummary = getChatInfoSummary as jest.MockedFunction<typeof getChatInfoSummary>;

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarUrl: null,
  lastReadAt: '2026-10-12T10:00:00Z',
});

const group: ChatSummary = {
  id: 'group-1',
  kind: 'group',
  ownerId: 'me',
  description: null,
  avatarUrl: null,
  title: 'Команда',
  username: null,
  channel: null,
  participants: [person('me', 'Я'), person('anna', 'Анна')],
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

const photo = 'https://x/media/anna/group-avatar/old.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'me';
  mockedGetChat.mockResolvedValue(group);
  mockedAvailable.mockResolvedValue(true);
  mockedSet.mockResolvedValue(undefined);
  mockedSetAvatar.mockResolvedValue(null);
  mockedSummary.mockResolvedValue({
    ownerId: 'anna',
    photos: 0,
    videos: 0,
    voices: 0,
    commonGroups: 0,
  });
  mockedUpload.mockResolvedValue({
    url: 'https://x/media/me/group-avatar/new.jpg',
    path: 'me/group-avatar/new.jpg',
  });
});

describe('ChatEditScreen', () => {
  it('keeps the check mark off until something changes', async () => {
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);

    expect(await screen.findByTestId('chat-edit-save')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('chat-username'), 'team');
    await screen.findByText('Имя свободно');

    expect(screen.getByTestId('chat-edit-save')).toBeEnabled();
  });

  it('saves a free username by the check mark and goes back', async () => {
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'team');
    await screen.findByText('Имя свободно');
    expect(mockedAvailable).toHaveBeenCalledWith('group', 'team', 'group-1');

    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith('group-1', 'team'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('clears the username', async () => {
    mockedGetChat.mockResolvedValue({ ...group, username: 'team' });

    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), '');
    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith('group-1', null));
  });

  it('refuses a dot and a taken name, and keeps the check mark off', async () => {
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'a.b');

    expect(await screen.findByText('Точка в имени недопустима')).toBeTruthy();
    expect(screen.getByTestId('chat-edit-save')).toBeDisabled();

    mockedAvailable.mockResolvedValue(false);
    await fireEvent.changeText(screen.getByTestId('chat-username'), 'busy');

    expect(await screen.findByText('Имя занято')).toBeTruthy();
    expect(screen.getByTestId('chat-edit-save')).toBeDisabled();
  });

  it('explains a network failure in plain words and stays on the screen', async () => {
    mockedSet.mockRejectedValue(new TypeError('Network request failed'));

    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-username'), 'team');
    await screen.findByText('Имя свободно');
    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    expect(
      await screen.findByText('Нет связи. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('opens only for the owner: another member is told so', async () => {
    mockedGetChat.mockResolvedValue({ ...group, ownerId: 'anna' });
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);

    expect(await screen.findByText('Изменять группу может только её владелец.')).toBeTruthy();
    expect(screen.queryByTestId('chat-edit-title')).toBeNull();
  });

  it('the owner renames the group', async () => {
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);

    await fireEvent.changeText(await screen.findByTestId('chat-edit-title'), '  Новая  ');
    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    await waitFor(() => expect(setChatTitle).toHaveBeenCalledWith('group-1', 'Новая'));
  });

  it('saves a multi-line description; a cleared one is removed', async () => {
    const { unmount } = await renderWithQuery(<ChatEditScreen chatId="group-1" />);

    await fireEvent.changeText(
      await screen.findByTestId('chat-edit-description'),
      ' Первая строка\nвторая ',
    );
    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    await waitFor(() =>
      expect(setChatDescription).toHaveBeenCalledWith('group-1', 'Первая строка\nвторая'),
    );
    await unmount();

    mockedGetChat.mockResolvedValue({ ...group, description: 'Было' });
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    await fireEvent.changeText(await screen.findByTestId('chat-edit-description'), '   ');
    await fireEvent.press(screen.getByTestId('chat-edit-save'));

    await waitFor(() => expect(setChatDescription).toHaveBeenCalledWith('group-1', null));
  });

  it('shows how many characters are left near the limit', async () => {
    await renderWithQuery(<ChatEditScreen chatId="group-1" />);
    const field = await screen.findByTestId('chat-edit-description');

    await fireEvent.changeText(field, 'а'.repeat(100));
    expect(screen.queryByTestId('chat-edit-description-left')).toBeNull();

    await fireEvent.changeText(field, 'а'.repeat(230));
    expect(screen.getByTestId('chat-edit-description-left')).toHaveTextContent('25');
  });

  describe('group photo', () => {
    it('a new photo waits in the draft and is uploaded by the check mark', async () => {
      await renderWithQuery(<ChatEditScreen chatId="group-1" />);
      await fireEvent.press(await screen.findByText('Установить новое фото'));

      expect(openMediaSheet).toHaveBeenCalledWith('avatar:group-edit');

      await fireEvent.press(screen.getByTestId('avatar-sheet-done'));
      await waitFor(() => expect(screen.getByTestId('chat-edit-save')).toBeEnabled());
      expect(mockedUpload).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByTestId('chat-edit-save'));

      await waitFor(() =>
        expect(mockedSetAvatar).toHaveBeenCalledWith(
          'group-1',
          'https://x/media/me/group-avatar/new.jpg',
        ),
      );
      expect(mockedUpload).toHaveBeenCalledWith('file:///g.jpg', 'me');
      expect(mockBack).toHaveBeenCalled();
    });

    it('removes the photo; a file someone else uploaded is left to them', async () => {
      mockedGetChat.mockResolvedValue({ ...group, avatarUrl: photo });
      mockedSetAvatar.mockResolvedValue(photo);

      await renderWithQuery(<ChatEditScreen chatId="group-1" />);
      await fireEvent.press(await screen.findByText('Удалить фото'));
      await fireEvent.press(screen.getByTestId('chat-edit-save'));

      await waitFor(() => expect(mockedSetAvatar).toHaveBeenCalledWith('group-1', null));
      expect(removeOwnGroupAvatar).toHaveBeenCalledWith(photo, 'me');
    });

    it('a refused photo is explained and the upload is cleaned up', async () => {
      mockedSetAvatar.mockRejectedValue(new TypeError('Network request failed'));

      await renderWithQuery(<ChatEditScreen chatId="group-1" />);
      await screen.findByText('Установить новое фото');
      await fireEvent.press(screen.getByTestId('avatar-sheet-done'));
      await waitFor(() => expect(screen.getByTestId('chat-edit-save')).toBeEnabled());
      await fireEvent.press(screen.getByTestId('chat-edit-save'));

      expect(
        await screen.findByText('Нет связи. Проверьте интернет и попробуйте ещё раз.'),
      ).toBeTruthy();
      expect(removeUploadedMedia).toHaveBeenCalledWith('me/group-avatar/new.jpg');
      expect(mockBack).not.toHaveBeenCalled();
    });
  });
});
