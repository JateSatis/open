import { requestClient } from '@/api/requestClient';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { EditDetailsScreen } from '@/features/chats/EditDetailsScreen';

import {
  ChannelUsernameTakenError,
  getChannel,
  setChannelAvatar,
  setChannelDescription,
  setChannelTitle,
  setChannelUsername,
  type Channel,
} from '@/api/channels';
import { isUsernameAvailable } from '@/api/usernames';
import { confirm } from '@/components/ConfirmDialog/store';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import {
  removeOwnChannelAvatar,
  uploadChannelAvatar,
  type PreparedAvatar,
} from '@/features/media';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/channels', () => {
  class MockTaken extends Error {}

  return {
    getChannel: jest.fn(),
    setChannelTitle: jest.fn(),
    setChannelDescription: jest.fn(),
    setChannelUsername: jest.fn(),
    setChannelAvatar: jest.fn(),
    ChannelUsernameTakenError: MockTaken,
  };
});

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));
jest.mock('@/components/ConfirmDialog/store', () => ({ confirm: jest.fn() }));

jest.mock('@/features/media', () => ({
  uploadChannelAvatar: jest.fn(),
  removePublicMedia: jest.fn(),
  removeOwnChannelAvatar: jest.fn(),
}));

const mockBack = jest.fn();
let mockBeforeRemove: ((event: unknown) => void) | null = null;

// Галочка живёт в шапке стека — мок рисует её прямо на экране.
jest.mock('@/navigation', () => ({
  useRouteParams: () => ({ target: { kind: 'channel', id: 'channel-1' } }),
  useRouter: () => ({ back: mockBack }),
  useNavigation: () => ({
    addListener: (_name: string, listener: (event: unknown) => void) => {
      mockBeforeRemove = listener;
      return () => undefined;
    },
    dispatch: jest.fn(),
  }),
  ScreenOptions: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight ? options.headerRight() : null,
}));

jest.mock('@/features/chats/MediaPickerSheet', () => ({ openMediaSheet: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet/MediaAvatarSheet', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    MediaAvatarSheet: ({ onDone }: { onDone: (avatar: Promise<PreparedAvatar>) => void }) => (
      <Pressable
        testID="avatar-sheet-done"
        onPress={() => onDone(Promise.resolve({ uri: 'file:///c.jpg', size: 512 }))}
      />
    ),
  };
});

let mockUserId = 'owner';

jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => mockUserId }));

const channel: Channel = {
  id: 'channel-1',
  title: 'Новости',
  description: null,
  username: 'news',
  avatarUrl: 'https://x/media/owner/channel-avatar/old.jpg',
  ownerId: 'owner',
  postsChatId: 'posts-1',
  subscribersCount: 0,
  readersCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'owner';
  mockBeforeRemove = null;
  jest.mocked(getChannel).mockResolvedValue(channel);
  jest.mocked(isUsernameAvailable).mockResolvedValue(true);
  jest.mocked(setChannelTitle).mockResolvedValue(undefined);
  jest.mocked(setChannelDescription).mockResolvedValue(undefined);
  jest.mocked(setChannelUsername).mockResolvedValue(undefined);
  jest.mocked(setChannelAvatar).mockResolvedValue(channel.avatarUrl);
  jest.mocked(uploadChannelAvatar).mockResolvedValue({
    url: 'https://x/media/owner/channel-avatar/new.jpg',
    path: 'owner/channel-avatar/new.jpg',
  });
  jest.mocked(confirm).mockResolvedValue(true);
});

describe('ChannelEditScreen', () => {
  it('is only for the owner', async () => {
    mockUserId = 'stranger';

    await renderWithQuery(<EditDetailsScreen />);

    expect(await screen.findByText('Изменять канал может только его владелец.')).toBeTruthy();
    expect(screen.queryByTestId('channel-edit-save')).toBeNull();
  });

  it('keeps the check mark off until something changes', async () => {
    await renderWithQuery(<EditDetailsScreen />);

    expect(await screen.findByTestId('channel-edit-save')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('channel-edit-title'), 'Новости дня');

    expect(screen.getByTestId('channel-edit-save')).toBeEnabled();
  });

  it('saves title, description and a free name, then goes back', async () => {
    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.changeText(await screen.findByTestId('channel-edit-title'), '  Новости дня ');
    await fireEvent.changeText(screen.getByTestId('chat-edit-description'), 'Коротко\nо главном');
    await fireEvent.changeText(screen.getByTestId('channel-username'), 'daily');
    await screen.findByText('Имя свободно');
    await fireEvent.press(screen.getByTestId('channel-edit-save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(setChannelTitle).toHaveBeenCalledWith('channel-1', 'Новости дня', requestClient());
    expect(setChannelDescription).toHaveBeenCalledWith('channel-1', 'Коротко\nо главном', requestClient());
    expect(setChannelUsername).toHaveBeenCalledWith('channel-1', 'daily', requestClient());
    expect(setChannelAvatar).not.toHaveBeenCalled();
  });

  it('a taken or empty name keeps the check mark off', async () => {
    jest.mocked(isUsernameAvailable).mockResolvedValue(false);

    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.changeText(await screen.findByTestId('channel-username'), 'busy');
    expect(await screen.findByText('Имя занято')).toBeTruthy();
    expect(screen.getByTestId('channel-edit-save')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('channel-username'), '');
    expect(screen.getByText('У канала должно быть имя')).toBeTruthy();
    expect(screen.getByTestId('channel-edit-save')).toBeDisabled();
  });

  it('an empty title keeps the check mark off', async () => {
    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.changeText(await screen.findByTestId('channel-edit-title'), '   ');

    expect(screen.getByTestId('channel-edit-save')).toBeDisabled();
  });

  it('a name taken at the last moment is explained and the screen stays', async () => {
    jest.mocked(setChannelUsername).mockRejectedValue(new ChannelUsernameTakenError('daily'));

    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.changeText(await screen.findByTestId('channel-username'), 'daily');
    await screen.findByText('Имя свободно');
    await fireEvent.press(screen.getByTestId('channel-edit-save'));

    expect(await screen.findByTestId('channel-edit-error')).toHaveTextContent('Имя занято');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('uploads a new photo by the check mark and removes the replaced own file', async () => {
    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.press(await screen.findByText('Установить новое фото'));
    expect(openMediaSheet).toHaveBeenCalledWith('avatar:channel-edit');

    await fireEvent.press(screen.getByTestId('avatar-sheet-done'));
    await waitFor(() => expect(screen.getByTestId('channel-edit-save')).toBeEnabled());
    expect(uploadChannelAvatar).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('channel-edit-save'));

    await waitFor(() =>
      expect(setChannelAvatar).toHaveBeenCalledWith(
        'channel-1',
        'https://x/media/owner/channel-avatar/new.jpg', requestClient()
      ),
    );
    expect(uploadChannelAvatar).toHaveBeenCalledWith('file:///c.jpg', 'owner', requestClient());
    expect(removeOwnChannelAvatar).toHaveBeenCalledWith(channel.avatarUrl, 'owner', requestClient());
    expect(mockBack).toHaveBeenCalled();
  });

  it('asks before leaving with unsaved changes', async () => {
    await renderWithQuery(<EditDetailsScreen />);

    await fireEvent.changeText(await screen.findByTestId('channel-edit-title'), 'Другое');
    const event = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    mockBeforeRemove?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Отменить изменения?' }),
    );
  });
});
