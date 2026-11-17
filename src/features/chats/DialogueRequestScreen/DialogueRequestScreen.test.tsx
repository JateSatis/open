import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { DialogueRequestScreen } from '.';

import { ContactRefusedError } from '@/api/contactErrors';
import { createChat } from '@/api/invites';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockReplace = jest.fn();

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({ addListener: () => () => undefined, getState: () => ({ index: 1 }) }),
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({}));
jest.mock('@/api/profile', () => ({
  getProfile: jest.fn((id: string) =>
    Promise.resolve({
      id,
      username: 'marina',
      displayName: 'Марина',
      avatarUrl: null,
      bio: null,
      status: null,
    }),
  ),
}));
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
  removeUploadedMedia: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  HoldToRecordRow: () => {
    throw new Error('в заявке записи голосового нет');
  },
}));

const mockedCreate = createChat as jest.MockedFunction<typeof createChat>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedCreate.mockResolvedValue({ outcome: 'created', chatId: 'chat-req' });
});

describe('DialogueRequestScreen', () => {
  it('К1.1 только текст: ни вложений, ни голосового, ни кружка', async () => {
    await renderWithQuery(<DialogueRequestScreen userId="user-2" />);

    expect(await screen.findByText('Заявка на диалог')).toBeTruthy();
    expect(screen.queryByTestId('composer-attach')).toBeNull();
    expect(screen.getByLabelText('Текст заявки')).toBeTruthy();
  });

  it('К1.1 первое сообщение и есть заявка — создаётся чат и открывается', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<DialogueRequestScreen userId="user-2" />);
    await user.type(await screen.findByLabelText('Текст заявки'), 'Привет!');
    await user.press(screen.getByTestId('composer-send'));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith({ inviteeIds: ['user-2'], requestText: 'Привет!' }),
    );
    expect(mockReplace).toHaveBeenCalledWith({ name: 'Chat', params: { chatId: 'chat-req' } });
  });

  it('К1.6 повтор после отказа — понятный отказ без подробностей', async () => {
    mockedCreate.mockRejectedValue(
      new ContactRefusedError('OPN09', 'Новую заявку этому человеку отправить пока нельзя.'),
    );
    const user = userEvent.setup();

    await renderWithQuery(<DialogueRequestScreen userId="user-2" />);
    await user.type(await screen.findByLabelText('Текст заявки'), 'Ещё раз');
    await user.press(screen.getByTestId('composer-send'));

    expect(
      await screen.findByText('Новую заявку этому человеку отправить пока нельзя.'),
    ).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
