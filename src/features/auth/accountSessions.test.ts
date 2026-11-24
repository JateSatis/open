import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { sessionOf } from '@/test/sessionOf';

const mockGoogle = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: mockGoogle, signOut: jest.fn() },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
  statusCodes: {},
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { googleSignIn: { webClientId: 'test' } } } }));
jest.mock('expo-apple-authentication', () => ({}));

function loadAuth() {
  // Новый граф модулей, как после уничтожения процесса. Диск остаётся прежним.
  jest.resetModules();
  jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
  const store: typeof import('./sessionStore') = require('./sessionStore');
  const api: typeof import('@/api/supabase') = require('@/api/supabase');
  const provider: typeof import('./signIn') = require('./signIn');
  const stop = store.subscribeToSession();
  return { ...store, api, provider, stop };
}

function fixture(id: string): Session {
  return {
    ...sessionOf(id, id + '-device'),
    refresh_token: 'fixture-' + id,
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}
const legacy = 'sb-isolation-auth-token';
const a = fixture('A');
const b = fixture('B');
const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const originalFetch = global.fetch;
jest.mock('./installationId', () => ({ getInstallationId: async () => 'fixture-installation' }));
beforeEach(async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://isolation.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'fixture-key';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(legacy, JSON.stringify(a));
  global.fetch = transport;
  transport.mockReset().mockRejectedValue(new Error('offline'));
});
afterEach(() => { global.fetch = originalFetch; });

it('использует отдельные клиенты SDK при обмене токена, выборе и адресном выходе', async () => {
  let auth = loadAuth();
  await auth.restoreAccounts();
  const clientA = auth.api.supabase;
  expect((await clientA.auth.getSession()).data.session).toEqual(a);
  expect(auth.getSelectedAccountId()).toBe('A');
  expect(await AsyncStorage.getItem(legacy)).toBeNull();

  mockGoogle.mockResolvedValueOnce({ type: 'cancelled' });
  expect(await auth.provider.signInWithGoogle()).toEqual({ status: 'cancelled' });
  expect(auth.api.supabase).toBe(clientA);
  expect(auth.getAccounts()).toEqual(['A']);

  mockGoogle.mockResolvedValue({ type: 'success', data: { idToken: 'provider-fixture' } });
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'rejected' }), { status: 400 }));
  expect((await auth.provider.signInWithGoogle()).status).toBe('error');
  expect((await clientA.auth.getSession()).data.session).toEqual(a);

  const observed: string[] = [];
  const { data } = clientA.auth.onAuthStateChange((_event, session) => {
    if (session) observed.push(session.user.id);
  });
  transport.mockResolvedValueOnce(new Response(JSON.stringify(b), { status: 200 }));
  expect(await auth.provider.signInWithGoogle()).toEqual({ status: 'success' });
  const clientB = auth.api.supabase;
  expect(clientB).not.toBe(clientA);
  expect((await clientB.auth.getSession()).data.session?.refresh_token).toBe(b.refresh_token);
  expect((await clientA.auth.getSession()).data.session).toEqual(a);
  expect(observed).not.toContain('B');
  data.subscription.unsubscribe();
  await auth.selectAccount('B');
  expect(auth.getAccounts()).toEqual(['A', 'B']);
  auth.stop();

  transport.mockClear();
  auth = loadAuth();
  await auth.restoreAccounts();
  expect(auth.getSelectedAccountId()).toBe('B');
  const restoredB = auth.api.supabase;
  expect((await restoredB.auth.getSession()).data.session?.user.id).toBe('B');
  await auth.selectAccount('A');
  expect((await auth.api.supabase.auth.getSession()).data.session).toEqual(a);
  expect(transport).not.toHaveBeenCalled();
  await auth.selectAccount('B');
  transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await auth.signOutAccount('A');
  expect(String(transport.mock.calls[0][0])).toContain('scope=local');
  expect(new Headers(transport.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer ' + a.access_token);
  expect(auth.getAccounts()).toEqual(['B']);
  expect(auth.api.supabase).toBe(restoredB);
  expect((await restoredB.auth.getSession()).data.session?.refresh_token).toBe(b.refresh_token);
  auth.stop();

  auth = loadAuth();
  await auth.restoreAccounts();
  expect(auth.getSelectedAccountId()).toBe('B');
  expect(auth.getAccounts()).toEqual(['B']);
  auth.stop();
});

it('выход из выбранного B оставляет A доступным для явного выбора после перезапуска', async () => {
  let auth = loadAuth();
  await auth.restoreAccounts();
  await auth.addSession(b);
  transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await auth.signOutAccount('B');
  expect(auth.getSelectedAccountId()).toBeNull();
  auth.stop();
  auth = loadAuth();
  await auth.restoreAccounts();
  expect(auth.getSelectedAccountId()).toBeNull();
  expect(auth.getAccounts()).toEqual(['A']);
  await auth.selectAccount('A');
  expect((await auth.api.supabase.auth.getSession()).data.session).toEqual(a);
  auth.stop();
});

it('выход из спящего B использует его сохранённый сеанс после смены session_id', async () => {
  const key = legacy + ':session:older-B';
  const storage: typeof import('./accountStorage') = require('./accountStorage');
  await storage.writeAccounts({
    accounts: [
      { userId: 'A', key: legacy + ':session:A' },
      { userId: 'B', key, sessionId: 'previous-B-session' },
    ],
    selected: 'A',
  });
  await AsyncStorage.setItem(legacy + ':session:A', JSON.stringify(a));
  await AsyncStorage.setItem(key, JSON.stringify(b));
  const auth = loadAuth();
  await auth.restoreAccounts();
  const slot = auth.useSessionStore.getState().accounts[1];
  const owner = await auth.savedSessionOwner(slot);
  const { signOutSavedAccount }: typeof import('./signOut') = require('./signOut');
  const { requestSelection }: typeof import('@/api/screenRequest') = require('@/api/screenRequest');
  transport.mockImplementation(async () => new Response(null, { status: 204 }));
  await signOutSavedAccount(slot, requestSelection(), owner);
  expect(auth.getAccounts()).toEqual(['A']);
  expect(auth.getSelectedAccountId()).toBe('A');
  expect(transport.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
    expect.stringContaining('mark_device_signed_out'), expect.stringContaining('scope=local'),
  ]));
  for (const [, init] of transport.mock.calls) {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + b.access_token);
  }
  auth.stop();
});

it.each(['до индекса', 'после индекса'])('продолжает прерванную миграцию (%s)', async phase => {
  const storage: typeof import('./accountStorage') = require('./accountStorage');
  if (phase === 'до индекса') {
    const set = AsyncStorage.setItem;
    const write = jest.mocked(set).getMockImplementation()!;
    jest.mocked(set).mockImplementationOnce(write).mockRejectedValueOnce(new Error('interrupted'));
    await expect(storage.readAccounts()).rejects.toThrow('interrupted');
  } else {
    await storage.readAccounts();
  }
  expect(await AsyncStorage.getItem(legacy)).not.toBeNull();
  let auth = loadAuth();
  await auth.restoreAccounts();
  expect(auth.getAccounts()).toEqual(['A']);
  expect((await auth.api.supabase.auth.getSession()).data.session).toEqual(a);
  transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await auth.signOutAccount('A');
  auth.stop();
  // Остаток прежнего ключа после прерывания уборки не должен воскресить A.
  await AsyncStorage.setItem(legacy, JSON.stringify(a));
  auth = loadAuth();
  await auth.restoreAccounts();
  expect(auth.getAccounts()).toEqual([]);
  expect(auth.getSelectedAccountId()).toBeNull();
  expect(await AsyncStorage.getItem(legacy)).toBeNull();
  auth.stop();
});
