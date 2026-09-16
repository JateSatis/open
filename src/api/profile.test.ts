import {
  getMyProfile,
  getProfile,
  NotAuthenticatedError,
  updateMyProfile,
  UsernameTakenError,
} from './profile';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
  },
}));

const auth = supabase.auth as unknown as { getSession: jest.Mock };
const from = supabase.from as unknown as jest.Mock;

const row = {
  id: 'user-1',
  username: 'maxim',
  display_name: 'Максим',
  avatar_url: 'https://cdn.example/a.jpg',
  bio: 'Привет',
};

/** Mimics the PostgREST builder chain, which returns `this` until `single()`. */
function mockChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'is', 'update']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
});

describe('getProfile', () => {
  it('maps the row to camelCase and skips soft-deleted profiles', async () => {
    const chain = mockChain({ data: row, error: null });

    await expect(getProfile('user-1')).resolves.toEqual({
      id: 'user-1',
      username: 'maxim',
      displayName: 'Максим',
      avatarUrl: 'https://cdn.example/a.jpg',
      bio: 'Привет',
    });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('keeps a profile without a username readable', async () => {
    mockChain({ data: { ...row, username: null, display_name: null }, error: null });

    await expect(getProfile('user-1')).resolves.toMatchObject({
      username: null,
      displayName: null,
    });
  });

  it('rethrows a query error', async () => {
    mockChain({ data: null, error: new Error('network down') });

    await expect(getProfile('user-1')).rejects.toThrow('network down');
  });
});

describe('getMyProfile', () => {
  it('reads the profile of the current session user', async () => {
    const chain = mockChain({ data: row, error: null });

    await expect(getMyProfile()).resolves.toMatchObject({ id: 'user-1' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('fails when there is no session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getMyProfile()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

describe('updateMyProfile', () => {
  it('writes snake_case columns for the session user only', async () => {
    const chain = mockChain({ data: row, error: null });

    await updateMyProfile({ displayName: 'Максим', bio: null, username: 'maxim' });

    expect(chain.update).toHaveBeenCalledWith({
      display_name: 'Максим',
      bio: null,
      username: 'maxim',
    });
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('leaves out fields the caller did not pass', async () => {
    const chain = mockChain({ data: row, error: null });

    await updateMyProfile({ bio: 'Новое' });

    expect(chain.update).toHaveBeenCalledWith({ bio: 'Новое' });
  });

  it('translates a unique violation into UsernameTakenError', async () => {
    mockChain({ data: null, error: { code: '23505', message: 'duplicate key' } });

    await expect(updateMyProfile({ username: 'maxim' })).rejects.toBeInstanceOf(
      UsernameTakenError,
    );
  });

  it('rethrows any other error untouched', async () => {
    mockChain({ data: null, error: { code: '42501', message: 'permission denied' } });

    await expect(updateMyProfile({ bio: 'x' })).rejects.toMatchObject({ code: '42501' });
  });
});
