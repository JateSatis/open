import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { useAuthBootstrap, useSession } from './useSession';
import { addSession, getAccounts, selectAccount, signOutAccount } from './sessionStore';
import { sessionOf } from '@/test/sessionOf';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;
const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
const mockRemoveChannel = jest.fn();
const mockGetChannels = jest.fn(() => ['channel']);
const mockSignOut = jest.fn();
const mockListeners: Listener[] = [];
jest.mock('@/api/supabase', () => ({
  legacySessionKey: 'legacy',
  selectApiClient: jest.fn(),
  createAccountClient: () => ({
    getChannels: mockGetChannels,
    removeChannel: mockRemoveChannel,
    removeAllChannels: jest.fn(),
    auth: {
      getSession: mockGetSession, signOut: mockSignOut, dispose: jest.fn(),
      onAuthStateChange: (listener: Listener) => {
        mockListeners.push(listener);
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  }),
}));

const a = { ...sessionOf('A', 'first'), refresh_token: 'test-a' };
const b = { ...sessionOf('B', 'second'), refresh_token: 'test-b' };
const offline = { data: { session: null }, error: { name: 'AuthRetryableFetchError' } };
const pending = () => new Promise<never>(() => {});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockListeners.length = 0;
  mockGetSession.mockImplementation(pending);
  await AsyncStorage.clear();
  await AsyncStorage.setItem('legacy', JSON.stringify(a));
});

it('повторяет локальное восстановление после временного отказа диска', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage temporarily unavailable'));
  const hook = await renderHook(useAuthBootstrap);
  expect(hook.result.current.localAccountId).toBe('A');
  expect(getAccounts()).toEqual(['A']);
});

it('публикует локальный ID до ответа SDK, при сетевой ошибке читает только его сессию', async () => {
  const sdk = deferred<typeof offline>();
  mockGetSession.mockReturnValue(sdk.promise);
  const first = await renderHook(useAuthBootstrap);
  const second = await renderHook(useSession);
  expect(first.result.current).toEqual({ localAccountId: 'A', sdkStatus: 'pending' });
  expect(second.result.current).toEqual({ session: null, isLoading: true, isAuthenticated: false });
  expect(mockListeners).toHaveLength(1);
  expect(mockGetSession).toHaveBeenCalledTimes(1);
  await act(() => sdk.resolve(offline));
  expect(first.result.current.sdkStatus).toBe('offline');
  expect(second.result.current.session).toEqual(a);
  await first.unmount();
  expect(mockUnsubscribe).not.toHaveBeenCalled();
  await second.unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it.each([null, '{', JSON.stringify({ ...a, refresh_token: '' }), JSON.stringify({ ...a, user: { id: 123 } })])(
  'открывает вход без SDK для отсутствующей или повреждённой прежней записи %#', async raw => {
    if (raw === null) await AsyncStorage.clear();
    else await AsyncStorage.setItem('legacy', raw);
    const hook = await renderHook(useAuthBootstrap);
    expect(hook.result.current).toEqual({ localAccountId: null, sdkStatus: 'signedOut' });
    expect(mockListeners).toHaveLength(0);
  },
);

it('предпочитает событие клиента A его запоздалому getSession и INITIAL_SESSION', async () => {
  const sdk = deferred<typeof offline>();
  mockGetSession.mockReturnValue(sdk.promise);
  const hook = await renderHook(useSession);
  const fresh = { ...a, ...sessionOf('A', 'first', 2) };
  await act(() => mockListeners[0]('TOKEN_REFRESHED', fresh));
  await act(() => sdk.resolve(offline));
  await act(() => mockListeners[0]('INITIAL_SESSION', a));
  expect(hook.result.current.session).toBe(fresh);
  await act(() => mockListeners[0]('SIGNED_OUT', null));
  expect(hook.result.current.session).toBeNull();
  expect(getAccounts()).toEqual([]);
});

it('запоздалые refresh, getSession и SIGNED_OUT клиента A сохраняют выбор и сеанс B', async () => {
  const sdk = deferred<typeof offline>();
  mockGetSession.mockReturnValueOnce(sdk.promise);
  const hook = await renderHook(useSession);
  await act(() => addSession(b));
  await act(() => mockListeners[0]('TOKEN_REFRESHED', a));
  await act(() => sdk.resolve(offline));
  expect(hook.result.current.session).toBe(b);
  await act(() => mockListeners[0]('SIGNED_OUT', null));
  await act(() => mockListeners[0]('SIGNED_IN', a));
  expect(hook.result.current.session).toBe(b);
  expect(getAccounts()).toEqual(['B']);
});

it('отбрасывает результаты остановленного наблюдателя после повторного запуска', async () => {
  const sdk = deferred<typeof offline>();
  mockGetSession.mockReturnValueOnce(sdk.promise);
  const first = await renderHook(useSession);
  await first.unmount();
  const second = await renderHook(useAuthBootstrap);
  await act(() => sdk.resolve(offline));
  await act(() => mockListeners[0]('SIGNED_OUT', null));
  expect(second.result.current).toEqual({ localAccountId: 'A', sdkStatus: 'pending' });
});

it('удаляет только окончательно потерянную сессию', async () => {
  mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: { code: 'refresh_token_not_found' } });
  const hook = await renderHook(useAuthBootstrap);
  await waitFor(() => expect(hook.result.current.localAccountId).toBeNull());
  expect(getAccounts()).toEqual([]);
});

it('завершает локальный выход без сети и восстанавливает оставшийся аккаунт после перезапуска', async () => {
  const first = await renderHook(useAuthBootstrap);
  await act(() => addSession(b));
  mockSignOut.mockRejectedValueOnce(new TypeError('Network request failed'));
  await act(() => signOutAccount('B'));
  expect(first.result.current.localAccountId).toBeNull();
  await first.unmount();
  mockGetSession.mockResolvedValueOnce(offline);
  const next = await renderHook(useSession);
  expect(getAccounts()).toEqual(['A']);
  await act(() => selectAccount('A'));
  expect(next.result.current.session).toEqual(a);
});

it('после ожидания отписки прежний выход не завершает новый сеанс того же пользователя', async () => {
  const hook = await renderHook(useSession);
  await act(() => mockListeners[0]('SIGNED_IN', a));
  const wait = deferred<void>();
  mockRemoveChannel.mockReturnValueOnce(wait.promise);
  const exiting = signOutAccount('A', { userId: 'A', sessionId: 'first' });
  await waitFor(() => expect(mockRemoveChannel).toHaveBeenCalled());
  const replacement = { ...a, ...sessionOf('A', 'replacement') };
  await act(() => mockListeners[0]('SIGNED_IN', replacement));
  wait.resolve();
  await exiting;
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(hook.result.current.session).toBe(replacement);
  await expect(selectAccount('unknown')).rejects.toThrow();
});
