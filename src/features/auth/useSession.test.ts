import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { useAuthBootstrap, useSession } from './useSession';

const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
type Listener = (event: AuthChangeEvent, session: Session | null) => void;
let authListener: Listener;
const mockOnAuthStateChange = jest.fn((listener: Listener) => {
  authListener = listener;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://bootstrap.supabase.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return {
    createClient: () => ({
      auth: {
        getSession: () => mockGetSession(),
        onAuthStateChange: (listener: Listener) => mockOnAuthStateChange(listener),
      },
    }),
  };
});

const session = {
  user: { id: 'user-1' }, expires_at: 1, access_token: 'access', refresh_token: 'refresh',
} as Session;
const storedKey = 'sb-bootstrap-auth-token';
const networkError = { name: 'AuthRetryableFetchError' };
const sdkOffline = { data: { session: null }, error: networkError };
const pending = () => new Promise<never>(() => {});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function resolveWith(value: Session | null) {
  mockGetSession.mockResolvedValue({ data: { session: value }, error: null });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resolveWith(null);
});

describe('useSession', () => {
  it('stays loading until the persisted session has been read', async () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useSession());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('opens the stored reader when an expired token cannot be refreshed offline', async () => {
    await AsyncStorage.setItem(storedKey, JSON.stringify(session));
    mockGetSession.mockResolvedValue(sdkOffline);
    const { result } = await renderHook(() => useSession());
    await act(() => authListener?.('INITIAL_SESSION', null));
    await waitFor(() => expect(result.current.session).toEqual(session));
    await act(() => authListener?.('SIGNED_OUT', null));
    expect(result.current.session).toBeNull();
  });

  it('reports no session when storage is empty', async () => {
    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('reports the persisted session as authenticated', async () => {
    resolveWith(session);

    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    expect(result.current.session).toBe(session);
    expect(result.current.isLoading).toBe(false);
  });

  it('picks up a sign-in delivered by onAuthStateChange', async () => {
    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => authListener?.('SIGNED_IN', session));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.session).toBe(session);
  });

  it('drops the session when the user signs out', async () => {
    resolveWith(session);

    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => authListener?.('SIGNED_OUT', null));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('shares one Supabase listener between every caller', async () => {
    const first = await renderHook(() => useSession());
    const second = await renderHook(() => useSession());

    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);

    await act(() => authListener?.('SIGNED_IN', session));

    expect(first.result.current.isAuthenticated).toBe(true);
    expect(second.result.current.isAuthenticated).toBe(true);
  });

  it('unsubscribes once the last caller unmounts', async () => {
    const first = await renderHook(() => useSession());
    const second = await renderHook(() => useSession());

    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    await first.unmount();
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    await second.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useAuthBootstrap', () => {
  it('publishes the expired account before SDK restore and keeps legacy consumers loading', async () => {
    const disk = deferred<string | null>();
    jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(disk.promise);
    const sdk = deferred<typeof sdkOffline>();
    mockGetSession.mockReturnValue(sdk.promise);
    const bootstrap = await renderHook(() => useAuthBootstrap());
    const legacy = await renderHook(() => useSession());

    expect(AsyncStorage.getItem).toHaveBeenCalledWith(storedKey);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    expect(bootstrap.result.current).toEqual({ localAccountId: undefined, sdkStatus: 'pending' });
    const loading = legacy.result.current;

    await act(() => disk.resolve(JSON.stringify(session)));
    expect(bootstrap.result.current).toEqual({ localAccountId: 'user-1', sdkStatus: 'pending' });
    expect(legacy.result.current).toBe(loading);
    expect(loading).toEqual({ session: null, isLoading: true, isAuthenticated: false });

    await act(() => sdk.resolve(sdkOffline));
    expect(bootstrap.result.current).toEqual({ localAccountId: 'user-1', sdkStatus: 'offline' });
    expect(legacy.result.current).toEqual({ session, isLoading: false, isAuthenticated: true });
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', null],
    ['invalid JSON', '{'],
    ['wrong id type', JSON.stringify({ ...session, user: { id: 123 } })],
    ['missing refresh token', JSON.stringify({ ...session, refresh_token: null })],
  ])('finishes the local read with %s storage while SDK is pending', async (_label, raw) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(raw);
    mockGetSession.mockImplementation(pending);
    const { result } = await renderHook(() => useAuthBootstrap());
    expect(result.current).toEqual({ localAccountId: null, sdkStatus: 'pending' });
  });

  it.each(['SIGNED_OUT', 'SIGNED_IN'] as const)('prefers %s over late reads of A', async (event) => {
    const disk = deferred<string>();
    const sdk = deferred<{ data: { session: Session }; error: null }>();
    jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(disk.promise);
    mockGetSession.mockReturnValue(sdk.promise);
    const bootstrap = await renderHook(() => useAuthBootstrap());
    const legacy = await renderHook(() => useSession());
    const current = event === 'SIGNED_OUT' ? null : { ...session, user: { ...session.user, id: 'B' } };
    await act(() => authListener(event, current));

    const expected = { localAccountId: current?.user.id ?? null, sdkStatus: current ? 'session' : 'signedOut' };
    expect(bootstrap.result.current).toEqual(expected);
    await act(() => disk.resolve(JSON.stringify(session)));
    await act(() => sdk.resolve({ data: { session }, error: null }));
    await act(() => authListener('INITIAL_SESSION', session));
    expect(bootstrap.result.current).toEqual(expected);
    expect(legacy.result.current.session).toBe(current);
  });

  it('reports an offline SDK result immediately and honours sign-out during fallback', async () => {
    const disk = deferred<string>();
    jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(disk.promise);
    mockGetSession.mockRejectedValue(networkError);
    const { result } = await renderHook(() => ({ bootstrap: useAuthBootstrap(), legacy: useSession() }));
    expect(result.current.bootstrap).toEqual({ localAccountId: undefined, sdkStatus: 'offline' });
    expect(result.current.legacy.isLoading).toBe(true);
    await act(() => authListener('SIGNED_OUT', null));
    await act(() => disk.resolve(JSON.stringify(session)));
    expect(result.current.bootstrap).toEqual({ localAccountId: null, sdkStatus: 'signedOut' });
    expect(result.current.legacy.session).toBeNull();
  });

  it('clears the local owner after a definitive SDK session loss', async () => {
    await AsyncStorage.setItem(storedKey, JSON.stringify(session));
    const sdk = deferred<{ data: { session: null }; error: { code: string } }>();
    mockGetSession.mockReturnValue(sdk.promise);
    const { result } = await renderHook(() => useAuthBootstrap());
    expect(result.current.localAccountId).toBe('user-1');
    await act(() => sdk.resolve({ data: { session: null }, error: { code: 'refresh_token_not_found' } }));
    expect(result.current).toEqual({ localAccountId: null, sdkStatus: 'signedOut' });
  });

  it('ignores both reads and callbacks from a stopped subscription after restart', async () => {
    const disk = deferred<string>();
    const sdk = deferred<{ data: { session: Session }; error: null }>();
    jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(disk.promise);
    mockGetSession.mockReturnValueOnce(sdk.promise);
    const first = await renderHook(() => useAuthBootstrap());
    const oldListener = authListener;
    await first.unmount();

    mockGetSession.mockImplementation(pending);
    const second = await renderHook(() => useAuthBootstrap());
    await act(() => disk.resolve(JSON.stringify(session)));
    await act(() => sdk.resolve({ data: { session }, error: null }));
    await act(() => oldListener('SIGNED_IN', session));
    expect(second.result.current).toEqual({ localAccountId: null, sdkStatus: 'pending' });
  });
});
