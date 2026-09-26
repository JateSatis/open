import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { AccountLifecycle } from './AccountLifecycle';
import { useSession } from './useSession';

import { registerDevice, signOutLocally, touchDevice } from '@/api/account';
import { getMediaSheetPhase, openMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import type { MediaLibraryItem } from '@/features/media';
import { useMediaSelection } from '@/features/media/selectionStore';
import { getActiveChatId, setActiveChatId } from '@/store/activeChat';

jest.mock('./useSession', () => ({ useSession: jest.fn() }));

jest.mock('@/api/account', () => ({
  registerDevice: jest.fn(),
  touchDevice: jest.fn(),
  signOutLocally: jest.fn(),
}));

jest.mock('./signIn', () => ({ signOutOfGoogle: jest.fn(() => Promise.resolve()) }));

jest.mock('./installationId', () => ({
  getInstallationId: () => Promise.resolve('install-1'),
}));

jest.mock('./deviceInfo', () => ({
  currentDeviceInfo: () =>
    Promise.resolve({
      installationId: 'install-1',
      platform: 'android',
      model: 'realme RMX3840',
      osVersion: '15',
      appVersion: '1.0.0',
    }),
}));

const mockedSession = useSession as jest.Mock;
const mockedTouch = touchDevice as jest.Mock;
const mockedRegister = registerDevice as jest.Mock;
const mockedSignOut = signOutLocally as jest.Mock;

function tokenFor(sessionId: string): string {
  const payload = btoa(JSON.stringify({ sub: 'x', session_id: sessionId }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `header.${payload}.signature`;
}

function sessionOf(userId: string, sessionId: string): Session {
  return { user: { id: userId }, access_token: tokenFor(sessionId) } as unknown as Session;
}

function signedIn(session: Session | null) {
  mockedSession.mockReturnValue({
    session,
    isAuthenticated: session !== null,
    isLoading: false,
  });
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockedTouch.mockResolvedValue(true);
  mockedRegister.mockResolvedValue(undefined);
  mockedSignOut.mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

async function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const utils = await render(
    <QueryClientProvider client={queryClient}>
      <AccountLifecycle />
    </QueryClientProvider>,
  );

  return { queryClient, ...utils };
}

describe('AccountLifecycle', () => {
  it('forgets everything about the previous user after sign-out', async () => {
    signedIn(sessionOf('user-a', 'session-a'));
    const { queryClient, rerender } = await setup();

    queryClient.setQueryData(['chats'], [{ id: 'chat-of-a' }]);
    queryClient.setQueryData(['profile', 'me'], { id: 'user-a' });
    useMediaSelection.setState({ order: ['asset-1'], items: { 'asset-1': {} as MediaLibraryItem } });
    setActiveChatId('chat-of-a');
    openMediaSheet();

    signedIn(null);
    await rerender(
      <QueryClientProvider client={queryClient}>
        <AccountLifecycle />
      </QueryClientProvider>,
    );

    expect(queryClient.getQueryData(['chats'])).toBeUndefined();
    expect(queryClient.getQueryData(['profile', 'me'])).toBeUndefined();
    expect(useMediaSelection.getState().order).toEqual([]);
    expect(getActiveChatId()).toBeNull();
    expect(getMediaSheetPhase()).toBe('closed');
  });

  it('also clears the cache when another account signs in on the same device', async () => {
    signedIn(sessionOf('user-a', 'session-a'));
    const { queryClient, rerender } = await setup();
    queryClient.setQueryData(['chats'], [{ id: 'chat-of-a' }]);

    signedIn(sessionOf('user-b', 'session-b'));
    await rerender(
      <QueryClientProvider client={queryClient}>
        <AccountLifecycle />
      </QueryClientProvider>,
    );

    expect(queryClient.getQueryData(['chats'])).toBeUndefined();
  });

  it('keeps the cache through a plain token refresh', async () => {
    signedIn(sessionOf('user-a', 'session-a'));
    const { queryClient, rerender } = await setup();
    queryClient.setQueryData(['chats'], [{ id: 'chat-of-a' }]);

    signedIn(sessionOf('user-a', 'session-a'));
    await rerender(
      <QueryClientProvider client={queryClient}>
        <AccountLifecycle />
      </QueryClientProvider>,
    );

    expect(queryClient.getQueryData(['chats'])).toEqual([{ id: 'chat-of-a' }]);
  });

  it('registers the device once per session', async () => {
    signedIn(sessionOf('user-a', 'session-a'));
    const { queryClient, rerender } = await setup();

    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(1));
    expect(mockedRegister.mock.calls[0][0]).toMatchObject({
      installationId: 'install-1',
      model: 'realme RMX3840',
    });

    // Обновление токена в том же сеансе — не повод регистрироваться заново.
    signedIn({ ...sessionOf('user-a', 'session-a'), expires_at: 1 } as Session);
    await rerender(
      <QueryClientProvider client={queryClient}>
        <AccountLifecycle />
      </QueryClientProvider>,
    );
    expect(mockedRegister).toHaveBeenCalledTimes(1);

    // Новый сеанс (например, после привязки второго способа входа) — да.
    signedIn(sessionOf('user-a', 'session-a2'));
    await rerender(
      <QueryClientProvider client={queryClient}>
        <AccountLifecycle />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(2));
  });

  it('signs out quietly when the session was ended from another device', async () => {
    mockedTouch.mockResolvedValue(false);
    signedIn(sessionOf('user-a', 'session-a'));

    await setup();

    await waitFor(() => expect(mockedSignOut).toHaveBeenCalled());
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it('checks the session again when the app comes back to the foreground', async () => {
    signedIn(sessionOf('user-a', 'session-a'));
    await setup();
    await waitFor(() => expect(mockedRegister).toHaveBeenCalled());

    mockedTouch.mockResolvedValue(false);
    await act(async () => appStateListener?.('active'));

    await waitFor(() => expect(mockedSignOut).toHaveBeenCalled());
  });

  it('does not sign out just because the network is down', async () => {
    mockedTouch.mockRejectedValue(new TypeError('Network request failed'));
    signedIn(sessionOf('user-a', 'session-a'));

    await setup();

    await waitFor(() => expect(mockedRegister).toHaveBeenCalled());
    expect(mockedSignOut).not.toHaveBeenCalled();
  });
});
