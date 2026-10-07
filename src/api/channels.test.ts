import { ChannelUsernameTakenError, createChannel, isUsernameAvailable } from './channels';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('createChannel', () => {
  it('creates the channel through the database function only', async () => {
    mockedRpc.mockResolvedValue({ data: { channel_id: 'ch-1', chat_id: 'chat-1' }, error: null });

    await expect(createChannel({ title: 'Канал', username: 'kanal' })).resolves.toEqual({
      channelId: 'ch-1',
      chatId: 'chat-1',
    });
    expect(mockedRpc).toHaveBeenCalledWith('create_channel', {
      channel_title: 'Канал',
      channel_username: 'kanal',
      channel_description: undefined,
      channel_avatar_url: undefined,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('turns OPN02 into a taken-username error', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'OPN02', message: 'taken' } });

    await expect(createChannel({ title: 'Канал', username: 'kanal' })).rejects.toBeInstanceOf(
      ChannelUsernameTakenError,
    );
  });

  it('passes other failures through', async () => {
    const failure = { code: '42501', message: 'denied' };

    mockedRpc.mockResolvedValue({ data: null, error: failure });

    await expect(createChannel({ title: 'Канал', username: 'kanal' })).rejects.toBe(failure);
  });
});

describe('isUsernameAvailable', () => {
  it('asks the shared handle registry', async () => {
    mockedRpc.mockResolvedValue({ data: false, error: null });

    await expect(isUsernameAvailable('Kanal')).resolves.toBe(false);
    expect(mockedRpc).toHaveBeenCalledWith('is_handle_available', { candidate: 'Kanal' });
  });
});
