import { isUsernameAvailable } from './usernames';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('isUsernameAvailable', () => {
  it('asks within the namespace of its own kind', async () => {
    mockedRpc.mockResolvedValue({ data: false, error: null });

    await expect(isUsernameAvailable('channel', 'Kanal')).resolves.toBe(false);
    expect(mockedRpc).toHaveBeenCalledWith('is_username_available', {
      target_kind: 'channel',
      candidate: 'Kanal',
      own_id: undefined,
    });
  });

  it('passes the edited entity so its own name is not taken', async () => {
    mockedRpc.mockResolvedValue({ data: true, error: null });

    await expect(isUsernameAvailable('group', 'team', 'chat-1')).resolves.toBe(true);
    expect(mockedRpc).toHaveBeenCalledWith('is_username_available', {
      target_kind: 'group',
      candidate: 'team',
      own_id: 'chat-1',
    });
  });

  it('throws when the server fails', async () => {
    const failure = { code: '500', message: 'boom' };

    mockedRpc.mockResolvedValue({ data: null, error: failure });

    await expect(isUsernameAvailable('profile', 'max')).rejects.toBe(failure);
  });
});
