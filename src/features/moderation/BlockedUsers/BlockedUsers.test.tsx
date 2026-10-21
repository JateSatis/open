import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { BlockedUsers } from '.';

import { listBlockedUsers, unblockUser } from '@/api/blocks';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({}));
jest.mock('@/api/blocks', () => ({
  listBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
  blockUser: jest.fn(),
  isBlockedByMe: jest.fn(),
}));

const mockedList = listBlockedUsers as jest.MockedFunction<typeof listBlockedUsers>;
const mockedUnblock = unblockUser as jest.MockedFunction<typeof unblockUser>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedUnblock.mockResolvedValue(undefined);
});

describe('BlockedUsers', () => {
  it('К2.10 показывает заблокированных с «Разблокировать»', async () => {
    mockedList.mockResolvedValue({
      items: [
        {
          id: 'user-a',
          displayName: 'Аня',
          username: 'anya',
          avatarUrl: null,
          cursorAt: 't',
          cursorId: 'b1',
        },
      ],
      next: null,
    });
    const user = userEvent.setup();

    await renderWithQuery(<BlockedUsers onOpenPerson={jest.fn()} />);
    await user.press(await screen.findByLabelText('Разблокировать: Аня'));

    await waitFor(() => expect(mockedUnblock).toHaveBeenCalledWith('user-a'));
  });

  it('К2.10 пустой список — понятным текстом', async () => {
    mockedList.mockResolvedValue({ items: [], next: null });

    await renderWithQuery(<BlockedUsers onOpenPerson={jest.fn()} />);

    expect(await screen.findByText(/Вы никого не заблокировали/)).toBeTruthy();
  });
});
