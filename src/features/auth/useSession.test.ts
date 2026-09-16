import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { useSession } from './useSession';

const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
let authListener: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;

jest.mock('@/api/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));

const session = { user: { id: 'user-1' } } as unknown as Session;

function resolveWith(value: Session | null) {
  mockGetSession.mockResolvedValue({ data: { session: value }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  authListener = null;
  resolveWith(null);
});

describe('useSession', () => {
  it('stays loading until the persisted session has been read', async () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useSession());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
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
