import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { NewChatRoute as NewChatScreen } from '@/navigation/screens/NewChatRoute';

import { searchPeople } from '@/api/groups';
import { createChat, DuplicateChatError } from '@/api/invites';
import { useSession } from '@/features/auth/useSession';
import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { removePublicMedia, uploadGroupAvatar, type PreparedAvatar } from '@/features/media';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockReplace = jest.fn();
const mockSearchParams = jest.fn((): { with?: string } => ({}));

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useRouteParams: () => mockSearchParams(),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({}));
jest.mock('@/api/profile', () => ({
  getProfile: jest.fn((id: string) =>
    Promise.resolve({
      id,
      username: 'stranger',
      displayName: 'Незнакомка',
      avatarUrl: null,
      bio: null,
      status: null,
    }),
  ),
}));
jest.mock('@/api/groups', () => ({ searchPeople: jest.fn() }));

jest.mock('@/api/invites', () => {
  class MockDuplicateChatError extends Error {
    readonly chatId: string;

    constructor(mockChatId: string) {
      super('duplicate');
      this.chatId = mockChatId;
    }
  }

  return { createChat: jest.fn(), DuplicateChatError: MockDuplicateChatError };
});

jest.mock('@/features/media', () => ({
  uploadGroupAvatar: jest.fn(),
  removePublicMedia: jest.fn(),
}));

// Шит аватарки — свой тест; «Готово» шита — кнопка мока.
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

const mockedUpload = uploadGroupAvatar as jest.MockedFunction<typeof uploadGroupAvatar>;
const mockedPeople = searchPeople as jest.MockedFunction<typeof searchPeople>;
const mockedCreate = createChat as jest.MockedFunction<typeof createChat>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams.mockReturnValue({});
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedPeople.mockResolvedValue({
    items: [
      { id: 'user-2', displayName: 'Марина', username: null, avatarUrl: null },
      { id: 'user-3', displayName: 'Пётр', username: null, avatarUrl: null },
    ],
    next: null,
  });
  mockedCreate.mockResolvedValue({ outcome: 'created', chatId: 'chat-new' });
  mockedUpload.mockResolvedValue({ url: 'https://x/g.jpg', path: 'user-1/group-avatar/g.jpg' });
  resetConnectionState();
  reportRealtimeJoined();
});

describe('NewChatScreen', () => {
  it('cannot create a chat until someone is picked', async () => {
    await renderWithQuery(<NewChatScreen />);

    await screen.findByText('Марина');
    expect(screen.getByRole('button', { name: 'Выберите, кого позвать' })).toBeDisabled();
  });

  it('invites one person into a dialogue and opens it', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(mockedCreate).toHaveBeenCalledWith({ inviteeIds: ['user-2'], title: '' });
    expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-new' } });
  });

  it('К1.1 не-другу — экран заявки, чат ещё не создан', async () => {
    mockedCreate.mockResolvedValue({ outcome: 'request_needed' });
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        name: 'Request',
        params: { userId: 'user-2' },
      }),
    );
  });

  it('К2.2 заблокированному — «Пользователь недоступен»', async () => {
    mockedCreate.mockRejectedValue(Object.assign(new Error('x'), { code: 'OPN08' }));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(await screen.findByText('Пользователь недоступен')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('arrives from a profile with that person already picked', async () => {
    mockSearchParams.mockReturnValueOnce({ with: 'user-3' });
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await screen.findByText('Пётр');

    expect(screen.getByRole('checkbox', { name: 'Пётр' })).toBeChecked();
    await user.press(screen.getByText('Позвать в диалог'));
    expect(mockedCreate).toHaveBeenCalledWith({ inviteeIds: ['user-3'], title: '' });
  });

  it('invites several people into a titled group', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Пётр'));
    await user.type(screen.getByLabelText('Название чата'), 'Поход');
    await user.press(screen.getByText('Позвать в группу (2)'));

    expect(mockedCreate).toHaveBeenCalledWith({ inviteeIds: ['user-2', 'user-3'], title: 'Поход' });
  });

  it('unpicks a person on a second tap', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Марина'));

    expect(screen.getByRole('checkbox', { name: 'Марина' })).not.toBeChecked();
    expect(screen.getByText('Выберите, кого позвать')).toBeTruthy();
  });

  it('opens the invite from the same people instead of a second chat', async () => {
    mockedCreate.mockResolvedValue({ outcome: 'incoming_invite', chatId: 'chat-theirs' });
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-theirs' } });
  });

  it('explains a repeat invite and leads to the chat that is still waiting', async () => {
    mockedCreate.mockRejectedValue(new DuplicateChatError('chat-old'));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(await screen.findByText(/Вы уже позвали этих людей/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await user.press(screen.getByText('Открыть тот чат'));
    expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-old' } });
  });

  it('drops the repeat warning once the choice of people changes', async () => {
    mockedCreate.mockRejectedValue(new DuplicateChatError('chat-old'));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));
    await screen.findByText(/Вы уже позвали этих людей/);

    await user.press(screen.getByText('Пётр'));

    expect(screen.queryByText(/Вы уже позвали этих людей/)).toBeNull();
  });

  it('reports a failure in plain words, not in server wording', async () => {
    mockedCreate.mockRejectedValue(new Error('permission denied for function create_chat'));
    const user = userEvent.setup();

    await renderWithQuery(<NewChatScreen />);
    await user.press(await screen.findByText('Марина'));
    await user.press(screen.getByText('Позвать в диалог'));

    expect(await screen.findByText('Не удалось создать чат')).toBeTruthy();
    expect(screen.queryByText(/permission/)).toBeNull();
  });

  describe('group photo', () => {
    async function pickPhoto(user: ReturnType<typeof userEvent.setup>) {
      await user.press(screen.getByLabelText('Выбрать фото группы'));
      expect(openMediaSheet).toHaveBeenCalledWith('avatar:group-new');
      await user.press(screen.getByTestId('avatar-sheet-done'));
      await screen.findByTestId('group-avatar-picker-preview');
    }

    it('the circle is idle until two people are picked', async () => {
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByLabelText('Выбрать фото группы'));

      expect(screen.getByLabelText('Выбрать фото группы')).toBeDisabled();
      expect(openMediaSheet).not.toHaveBeenCalled();

      await user.press(screen.getByText('Пётр'));
      expect(screen.getByLabelText('Выбрать фото группы')).toBeEnabled();
    });

    it('creates the group with the photo uploaded first', async () => {
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByText('Пётр'));
      await pickPhoto(user);
      await user.press(screen.getByText('Позвать в группу (2)'));

      expect(mockedUpload).toHaveBeenCalledWith('file:///g.jpg', 'user-1');
      expect(mockedCreate).toHaveBeenCalledWith({
        inviteeIds: ['user-2', 'user-3'],
        title: '',
        avatarUrl: 'https://x/g.jpg',
      });
      expect(removePublicMedia).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-new' } });
    });

    it('keeps the photo while the choice narrows to one and back', async () => {
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByText('Пётр'));
      await pickPhoto(user);

      await user.press(screen.getByText('Пётр'));
      expect(screen.getByLabelText('Сменить фото группы')).toBeDisabled();
      expect(screen.getByTestId('group-avatar-picker-preview')).toBeTruthy();

      await user.press(screen.getByText('Пётр'));
      expect(screen.getByLabelText('Сменить фото группы')).toBeEnabled();
      expect(screen.getByTestId('group-avatar-picker-preview')).toBeTruthy();
    });

    it('a dialogue ignores the photo and uploads nothing', async () => {
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByText('Пётр'));
      await pickPhoto(user);
      await user.press(screen.getByText('Пётр'));
      await user.press(screen.getByText('Позвать в диалог'));

      expect(mockedUpload).not.toHaveBeenCalled();
      expect(mockedCreate).toHaveBeenCalledWith({ inviteeIds: ['user-2'], title: '' });
    });

    it('a repeat invite removes the uploaded photo', async () => {
      mockedCreate.mockRejectedValue(new DuplicateChatError('chat-old'));
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByText('Пётр'));
      await pickPhoto(user);
      await user.press(screen.getByText('Позвать в группу (2)'));

      expect(await screen.findByText(/Вы уже позвали этих людей/)).toBeTruthy();
      expect(removePublicMedia).toHaveBeenCalledWith('user-1/group-avatar/g.jpg');
    });

    it('an invite from the same people opens their chat and removes the unused photo', async () => {
      mockedCreate.mockResolvedValue({ outcome: 'incoming_invite', chatId: 'chat-theirs' });
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);
      await user.press(await screen.findByText('Марина'));
      await user.press(screen.getByText('Пётр'));
      await pickPhoto(user);
      await user.press(screen.getByText('Позвать в группу (2)'));

      expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-theirs' } });
      expect(removePublicMedia).toHaveBeenCalledWith('user-1/group-avatar/g.jpg');
    });
  });

  describe('people without a catalogue', () => {
    it('keeps a person picked from their profile visible though they are not among people I know', async () => {
      mockSearchParams.mockReturnValue({ with: 'user-77' });
      const user = userEvent.setup();

      await renderWithQuery(<NewChatScreen />);

      // Незнакомого без запроса в списке нет — выбранный не должен быть невидимым.
      expect(await screen.findByRole('checkbox', { name: 'Незнакомка' })).toBeChecked();
      expect(screen.getByText('Марина')).toBeTruthy();

      await user.press(screen.getByRole('checkbox', { name: 'Незнакомка' }));
      expect(screen.queryByRole('checkbox', { name: 'Незнакомка' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Выберите, кого позвать' })).toBeDisabled();
    });

    it('shows people I know without a query: the server gives friends and people from my chats', async () => {
      await renderWithQuery(<NewChatScreen />);

      await screen.findByText('Марина');
      // Пустой запрос — не «все пользователи», а знакомые: так отвечает база.
      expect(mockedPeople).toHaveBeenCalledWith('', null, expect.anything());
    });

    it('finds anyone else only by searching the server', async () => {
      const user = userEvent.setup();
      mockedPeople.mockImplementation(async (query) =>
        query === 'вера'
          ? { items: [{ id: 'user-9', displayName: 'Вера', username: 'vera', avatarUrl: null }], next: null }
          : { items: [], next: null },
      );

      await renderWithQuery(<NewChatScreen />);
      expect(
        await screen.findByText(/Здесь будут ваши друзья и люди из ваших чатов/),
      ).toBeTruthy();

      await user.type(screen.getByLabelText('Поиск людей'), 'вера');

      expect(await screen.findByText('Вера')).toBeTruthy();
      await waitFor(() => expect(mockedPeople).toHaveBeenCalledWith('вера', null, expect.anything()));
    });

    it('explains the search rate limit in plain words', async () => {
      mockedPeople.mockRejectedValue({ code: 'OPN06', message: 'Слишком много запросов поиска' });

      await renderWithQuery(<NewChatScreen />);

      expect(
        await screen.findByText(/Слишком много запросов поиска подряд/),
      ).toBeTruthy();
    });
  });
});
