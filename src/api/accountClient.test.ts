import type { Session } from '@supabase/supabase-js';
import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import { AccountClient } from './accountClient';

const transport = jest.fn().mockImplementation(async () => new Response('null'));
const client = new AccountClient('https://bootstrap.test', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: transport },
  db: { retry: false },
});
const account = (id: string) => ({ user: { id }, access_token: 'test-' + id }) as Session;
const write = () => client.rpc('unsubscribe_from_chat', { target_chat: 'cached' });

afterEach(() => {
  useSessionStore.setState(emptyState);
  jest.restoreAllMocks();
  transport.mockClear();
});

it('прямой RPC локального аккаунта не ожидает токен другого пользователя', async () => {
  useSessionStore.setState({ localAccountId: 'a', sdkStatus: 'pending' });
  const getSession = jest.spyOn(client.auth, 'getSession');
  expect((await write()).error).toBeTruthy();
  expect(getSession).not.toHaveBeenCalled();

  const b = account('b');
  useSessionStore.setState({ localAccountId: 'b', sdkStatus: 'session', session: b });
  expect(transport).not.toHaveBeenCalled();
  getSession.mockResolvedValue({ data: { session: b }, error: null });
  expect((await write()).error).toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-b');
});

it('отклоняет RPC, если владелец сменился во время refresh', async () => {
  const a = account('a');
  const b = account('b');
  useSessionStore.setState({ localAccountId: 'a', sdkStatus: 'session', session: a });
  jest.spyOn(client.auth, 'getSession').mockImplementation(async () => {
    useSessionStore.setState({ localAccountId: 'b', sdkStatus: 'session', session: b });
    return { data: { session: b }, error: null };
  });
  expect((await write()).error).toBeTruthy();
  expect(transport).not.toHaveBeenCalled();
});
