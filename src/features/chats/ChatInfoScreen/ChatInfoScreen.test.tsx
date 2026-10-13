import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatInfoScreen } from '.';

import { getChat, setChatUsername, type ChatSummary } from '@/api/chats';
import { isUsernameAvailable } from '@/api/usernames';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/chats', () => {
  class MockTaken extends Error {}

  return {
    getChat: jest.fn(),
    setChatUsername: jest.fn(),
    ChatUsernameTakenError: MockTaken,
  };
});

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));

let mockUserId = 'me';

jest.mock('@/features/chats/useCurrentUserId', () => ({
  useCurrentUserId: () => mockUserId,
}));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedSet = setChatUsername as jest.MockedFunction<typeof setChatUsername>;
const mockedAvailable = isUsernameAvailable as jest.MockedFunction<typeof isUsernameAvailable>;

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarUrl: null,
  lastReadAt: '2026-10-12T10:00:00Z',
});

const group: ChatSummary = {
  id: 'group-1',
  kind: 'group',
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
});
