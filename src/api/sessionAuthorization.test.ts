import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import { sessionOf } from '@/test/sessionOf';
import { sessionAuthorization } from './sessionAuthorization';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
const owner = { userId: 'me', sessionId: 'first' };

beforeEach(() => {
  useSessionStore.setState({ sdkStatus: 'session', session: sessionOf('me', 'first') });
});
afterEach(() => useSessionStore.setState(emptyState));

it('берёт обновлённый SDK токен того же сеанса', async () => {
  const fresh = sessionOf('me', 'first', 2);
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: fresh }, error: null });
  await expect(sessionAuthorization(owner)).resolves.toBe(`Bearer ${fresh.access_token}`);
});

it('отбрасывает токен повторного входа того же пользователя', async () => {
  const next = sessionOf('me', 'next');
  jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: next }, error: null });
  await expect(sessionAuthorization(owner)).rejects.toThrow('Сессия аккаунта изменилась');
});
