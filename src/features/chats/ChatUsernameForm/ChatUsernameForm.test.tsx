import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatUsernameForm } from '.';

import { setChatUsername } from '@/api/chats';
import { isUsernameAvailable } from '@/api/usernames';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/chats', () => {
  class MockTaken extends Error {}

  return { setChatUsername: jest.fn(), ChatUsernameTakenError: MockTaken };
});

jest.mock('@/api/usernames', () => ({ isUsernameAvailable: jest.fn() }));

const mockedSet = setChatUsername as jest.MockedFunction<typeof setChatUsername>;
const mockedAvailable = isUsernameAvailable as jest.MockedFunction<typeof isUsernameAvailable>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSet.mockResolvedValue(undefined);
  mockedAvailable.mockResolvedValue(true);
});

describe('ChatUsernameForm', () => {
  it('keeps «Сохранить» off while nothing changed', async () => {
    await renderWithQuery(<ChatUsernameForm chatId="group-1" current="team" />);

    expect(screen.getByTestId('chat-username')).toHaveDisplayValue('team');
    expect(screen.getByTestId('chat-username-save')).toBeDisabled();
    expect(mockedAvailable).not.toHaveBeenCalled();
  });

  it('saves a cleared name as no name', async () => {
    await renderWithQuery(<ChatUsernameForm chatId="group-1" current="team" />);

    await fireEvent.changeText(screen.getByTestId('chat-username'), '');
    await fireEvent.press(screen.getByTestId('chat-username-save'));

    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith('group-1', null));
  });

  it('waits for the availability answer before allowing a save', async () => {
    await renderWithQuery(<ChatUsernameForm chatId="group-1" current={null} />);

    await fireEvent.changeText(screen.getByTestId('chat-username'), 'team');

    expect(screen.getByTestId('chat-username-save')).toBeDisabled();
    expect(await screen.findByText('Имя свободно')).toBeTruthy();
    expect(screen.getByTestId('chat-username-save')).toBeEnabled();
  });
});
