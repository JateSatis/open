import {
  getMyProfile,
  getProfile,
  NotAuthenticatedError,
  ProfileUnavailableError,
  updateMyProfile,
  UsernameTakenError,
} from './profile';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const auth = supabase.auth as unknown as { getSession: jest.Mock };
const from = supabase.from as unknown as jest.Mock;
const rpc = supabase.rpc as unknown as jest.Mock;

const card = {
  id: 'user-1',
  username: 'maxim',
  display_name: 'Максим',
  avatar_url: 'user-1/a.jpg',
  bio: 'Привет',
  status: 'в отпуске',
  masked: false,
};

/** Цепочка `update().eq()` — ответ отдаёт последний вызов. */
function mockUpdate(result: { error: unknown }) {
  const chain = { update: jest.fn(), eq: jest.fn() };
  chain.update.mockReturnValue(chain);
  chain.eq.mockResolvedValue(result);
  from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
  rpc.mockResolvedValue({ data: [card], error: null });
});

describe('getProfile', () => {
  it('reads the person as the viewer sees them, never the profiles table', async () => {
    await expect(getProfile('user-1')).resolves.toEqual({
      id: 'user-1',
      username: 'maxim',
      displayName: 'Максим',
      avatarUrl: 'user-1/a.jpg',
      bio: 'Привет',
      status: 'в отпуске',
      masked: false,
    });
    expect(rpc).toHaveBeenCalledWith('profile_cards', { ids: ['user-1'] });
    expect(from).not.toHaveBeenCalled();
  });

  it('shows a hidden person under the alias, without username, bio and status', async () => {
    rpc.mockResolvedValue({
      data: [{ ...card, display_name: 'Илья Муромцев', username: null, bio: null, status: null, avatar_url: null, masked: true }],
      error: null,
    });

    await expect(getProfile('user-1')).resolves.toMatchObject({
      displayName: 'Илья Муромцев',
      username: null,
      bio: null,
      status: null,
      avatarUrl: null,
      masked: true,
    });
  });

  it('treats a missing card as an unavailable profile', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(getProfile('user-1')).rejects.toBeInstanceOf(ProfileUnavailableError);
  });

  it('rethrows a query error', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('network down') });

    await expect(getProfile('user-1')).rejects.toThrow('network down');
  });
});

describe('getMyProfile', () => {
  it('reads the profile of the current session user', async () => {
    await expect(getMyProfile()).resolves.toMatchObject({ id: 'user-1' });
    expect(rpc).toHaveBeenCalledWith('profile_cards', { ids: ['user-1'] });
  });

  it('fails when there is no session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getMyProfile()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

describe('updateMyProfile', () => {
  it('writes snake_case columns for the session user only and rereads the card', async () => {
    const chain = mockUpdate({ error: null });

    await expect(
      updateMyProfile({ displayName: 'Максим', bio: null, username: 'maxim' }),
    ).resolves.toMatchObject({ displayName: 'Максим' });

    expect(from).toHaveBeenCalledWith('profiles');
    expect(chain.update).toHaveBeenCalledWith({
      display_name: 'Максим',
      bio: null,
      username: 'maxim',
    });
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(rpc).toHaveBeenCalledWith('profile_cards', { ids: ['user-1'] });
  });

  it('leaves out fields the caller did not pass', async () => {
    const chain = mockUpdate({ error: null });

    await updateMyProfile({ bio: 'Новое' });

    expect(chain.update).toHaveBeenCalledWith({ bio: 'Новое' });
  });

  it('writes the status and never touches service columns', async () => {
    const chain = mockUpdate({ error: null });

    await updateMyProfile({ status: 'в отпуске', avatarUrl: null });

    const patch = chain.update.mock.calls[0][0] as Record<string, unknown>;

    expect(patch).toEqual({ status: 'в отпуске', avatar_url: null });
    expect(patch).not.toHaveProperty('deleted_at');
    expect(patch).not.toHaveProperty('id');
  });

  it('translates a unique violation into UsernameTakenError', async () => {
    mockUpdate({ error: { code: '23505', message: 'duplicate key' } });

    await expect(updateMyProfile({ username: 'maxim' })).rejects.toBeInstanceOf(
      UsernameTakenError,
    );
  });

  it('rethrows any other error untouched', async () => {
    mockUpdate({ error: { code: '42501', message: 'permission denied' } });

    await expect(updateMyProfile({ bio: 'x' })).rejects.toMatchObject({ code: '42501' });
  });
});
