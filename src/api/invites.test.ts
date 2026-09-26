import { acceptInvite, createChat, declineInvite, DuplicateChatError } from './invites';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createChat', () => {
  it('goes through the database function and never writes members itself', async () => {
    mockedRpc.mockResolvedValue({ data: { chat_id: 'chat-1', outcome: 'created' }, error: null });

    await expect(createChat({ inviteeIds: ['user-2'], title: '  Поход ' })).resolves.toEqual({
      outcome: 'created',
      chatId: 'chat-1',
    });
    expect(mockedRpc).toHaveBeenCalledWith('create_chat', {
      invitee_ids: ['user-2'],
      chat_title: 'Поход',
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('sends no title rather than a blank one', async () => {
    mockedRpc.mockResolvedValue({ data: { chat_id: 'chat-1', outcome: 'created' }, error: null });

    await createChat({ inviteeIds: ['user-2'], title: '   ' });

    expect(mockedRpc).toHaveBeenCalledWith('create_chat', {
      invitee_ids: ['user-2'],
      chat_title: null,
    });
  });

  it('passes on an incoming invite from the same people', async () => {
    mockedRpc.mockResolvedValue({
      data: { chat_id: 'chat-2', outcome: 'incoming_invite' },
      error: null,
    });

    await expect(createChat({ inviteeIds: ['user-2'] })).resolves.toEqual({
      outcome: 'incoming_invite',
      chatId: 'chat-2',
    });
  });

  it('turns a repeated set of people into an error pointing at the waiting chat', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: 'OPN01', message: 'Вы уже позвали этих людей', details: 'chat-old' },
    });

    const failure = createChat({ inviteeIds: ['user-2'] });

    await expect(failure).rejects.toBeInstanceOf(DuplicateChatError);
    await expect(failure).rejects.toMatchObject({ chatId: 'chat-old' });
  });

  it('passes any other refusal through as it is', async () => {
    const refusal = { code: '22023', message: 'Нельзя позвать самого себя', details: null };
    mockedRpc.mockResolvedValue({ data: null, error: refusal });

    await expect(createChat({ inviteeIds: ['user-1'] })).rejects.toBe(refusal);
  });
});

describe('answering an invite', () => {
  it('accepts through the database function', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });

    await acceptInvite('chat-1');

    expect(mockedRpc).toHaveBeenCalledWith('accept_chat_invite', { target_chat: 'chat-1' });
  });

  it('surfaces the refusal to decline an accepted invite', async () => {
    const refusal = { code: '22023', message: 'Заявка уже принята' };
    mockedRpc.mockResolvedValue({ data: null, error: refusal });

    await expect(declineInvite('chat-1')).rejects.toBe(refusal);
    expect(mockedRpc).toHaveBeenCalledWith('decline_chat_invite', { target_chat: 'chat-1' });
  });
});
