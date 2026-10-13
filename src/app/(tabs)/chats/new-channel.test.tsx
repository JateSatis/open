import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';

import NewChannelScreen from './new-channel';

import { ChannelUsernameTakenError, createChannel } from '@/api/channels';
import { isUsernameAvailable } from '@/api/usernames';
import { useSession } from '@/features/auth/useSession';
import { removeUploadedMedia, uploadChannelAvatar } from '@/features/media';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/channels', () => {
  class MockTaken extends Error {
    readonly username: string;

    constructor(mockUsername: string) {
      super('taken');
      this.username = mockUsername;
    }
  }

  return {
    createChannel: jest.fn(),
    ChannelUsernameTakenError: MockTaken,
  };
});

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));

jest.mock('@/features/media', () => ({
  uploadChannelAvatar: jest.fn(),
  removeUploadedMedia: jest.fn(),
}));

// Выбор фото — свой тест шита; здесь круг сразу отдаёт готовый квадрат.
jest.mock('@/features/chats/AvatarPicker', () => ({
  AvatarPicker: ({ onChange }: { onChange: (uri: string) => void }) => {
    const { Pressable: MockPressable, Text: MockText } = jest.requireActual('react-native');

    return (
      <MockPressable accessibilityRole="button" onPress={() => onChange('file:///avatar.jpg')}>
        <MockText>Выбрать аватарку</MockText>
      </MockPressable>
    );
  },
}));

const mockedCreate = createChannel as jest.MockedFunction<typeof createChannel>;
const mockedAvailable = isUsernameAvailable as jest.MockedFunction<typeof isUsernameAvailable>;
const mockedUpload = uploadChannelAvatar as jest.MockedFunction<typeof uploadChannelAvatar>;
const mockedRemove = removeUploadedMedia as jest.MockedFunction<typeof removeUploadedMedia>;

beforeEach(() => {
  jest.clearAllMocks();
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedAvailable.mockImplementation(async (_kind, name) => name !== 'taken_name');
  mockedCreate.mockResolvedValue({ channelId: 'channel-1', chatId: 'chat-1' });
  mockedUpload.mockResolvedValue({ url: 'https://cdn/avatar.jpg', path: 'user-1/channel-avatar/a.jpg' });
  mockedRemove.mockResolvedValue(true);
});

const createButton = () => screen.getByTestId('create-channel-button');

async function fill(title: string, username: string) {
  await fireEvent.changeText(screen.getByTestId('channel-title'), title);
  await fireEvent.changeText(screen.getByTestId('channel-username'), username);
}

describe('NewChannelScreen', () => {
  it('shows the avatar circle and three fields, with «Создать» disabled', async () => {
    await renderWithQuery(<NewChannelScreen />);

    expect(screen.getByText('Название')).toBeTruthy();
    expect(screen.getByText('Описание')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(createButton()).toBeDisabled();
  });

  it('rejects a malformed username without asking the server', async () => {
    await renderWithQuery(<NewChannelScreen />);
    await fill('Канал', 'Ab');

    expect(await screen.findByText('Минимум 3 символа')).toBeTruthy();
    expect(mockedAvailable).not.toHaveBeenCalled();
    expect(createButton()).toBeDisabled();
  });

  it('says the name is taken and keeps «Создать» disabled', async () => {
    await renderWithQuery(<NewChannelScreen />);
    await fill('Канал', 'taken_name');

    expect(await screen.findByText('Имя занято')).toBeTruthy();
    expect(mockedAvailable).toHaveBeenCalledWith('channel', 'taken_name', undefined);
    expect(createButton()).toBeDisabled();
  });

  it('shows the fixed .ch suffix next to the name', async () => {
    await renderWithQuery(<NewChannelScreen />);

    expect(screen.getByTestId('channel-username-suffix')).toHaveTextContent('.ch');
  });

  it('refuses a name with a dot and keeps «Создать» disabled', async () => {
    await renderWithQuery(<NewChannelScreen />);
    await fill('Канал', 'a.b');

    expect(await screen.findByText('Точка в имени недопустима')).toBeTruthy();
    expect(mockedAvailable).not.toHaveBeenCalled();
    expect(createButton()).toBeDisabled();
  });

  it('drops a pasted .ch suffix and keeps only the name', async () => {
    await renderWithQuery(<NewChannelScreen />);
    await fill('Канал', '@news.ch');

    expect(screen.getByTestId('channel-username')).toHaveDisplayValue('news');
  });

  it('creates a channel with a free name and replaces the form with it', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChannelScreen />);
    await fill('Мой канал', 'my_channel');

    expect(await screen.findByText('Имя свободно')).toBeTruthy();
    expect(createButton()).toBeEnabled();

    await user.press(createButton());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/chats/channel/channel-1'));
    expect(mockedCreate).toHaveBeenCalledWith(
      { title: 'Мой канал', username: 'my_channel', description: null, avatarUrl: null },
      expect.anything(),
    );
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('removes the uploaded avatar when creation fails and keeps the form', async () => {
    const user = userEvent.setup();

    mockedCreate.mockRejectedValue(new ChannelUsernameTakenError('my_channel'));

    await renderWithQuery(<NewChannelScreen />);
    await user.press(screen.getByText('Выбрать аватарку'));
    await fill('Мой канал', 'my_channel');
    await screen.findByText('Имя свободно');
    await user.press(createButton());

    expect(await screen.findByTestId('create-channel-error')).toHaveTextContent('Имя занято');
    expect(mockedRemove).toHaveBeenCalledWith('user-1/channel-avatar/a.jpg');
    expect(screen.getByTestId('channel-title').props.value).toBe('Мой канал');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
