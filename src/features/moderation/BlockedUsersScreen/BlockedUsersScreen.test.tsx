import { screen, userEvent } from '@testing-library/react-native';

import { BlockedRoute as BlockedUsersRoute } from '@/navigation/screens/BlockedRoute';

import { listBlockedUsers, unblockUser } from '@/api/blocks';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('@/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({}));
jest.mock('@/api/blocks', () => ({ listBlockedUsers: jest.fn(), unblockUser: jest.fn() }));

it('нажатие на имя открывает профиль выбранного человека и сохраняет блокировку', async () => {
  jest.mocked(listBlockedUsers).mockResolvedValue({
    items: [
      {
        id: 'user-a',
        displayName: 'Аня',
        username: 'anya',
        avatarUrl: null,
        cursorAt: 't',
        cursorId: 'b1',
      },
      {
        id: 'user-b',
        displayName: 'Борис',
        username: 'boris',
        avatarUrl: null,
        cursorAt: 't',
        cursorId: 'b2',
      },
    ],
    next: null,
  });
  const user = userEvent.setup();

  await renderWithQuery(<BlockedUsersRoute />);
  await user.press(await screen.findByText('Борис'));

  expect(mockPush).toHaveBeenCalledWith({
    name: 'Person',
    params: { userId: 'user-b' },
  });
  expect(unblockUser).not.toHaveBeenCalled();
});
