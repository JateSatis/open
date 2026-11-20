import type { Session } from '@supabase/supabase-js';

import { readStoredSession, supabase } from '@/api/supabase';
import { isNetworkError } from '@/lib/network';

import { emptyState, useSessionStore, type AuthBootstrap } from './sessionState';

export { useSessionStore, type AuthBootstrap, type SessionState } from './sessionState';

let stop: (() => void) | undefined;
let refCount = 0;

function settle(session: Session | null, sdkStatus: AuthBootstrap['sdkStatus']) {
  useSessionStore.setState({
    session,
    isAuthenticated: session !== null,
    isLoading: false,
    localAccountId: session?.user.id ?? null,
    sdkStatus,
  });
}

function start() {
  let active = true;
  let sdkDecided = false;

  function applySdkSession(session: Session | null) {
    sdkDecided = true;
    settle(session, session ? 'session' : 'signedOut');
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    // Пустой INITIAL_SESSION приходит и при сетевой ошибке обновления токена.
    if (event === 'INITIAL_SESSION' && (!session || sdkDecided)) return;
    applySdkSession(session);
  });
  const stored = readStoredSession().catch(() => null);
  void stored.then((session) => {
    if (active && !sdkDecided) {
      useSessionStore.setState({ localAccountId: session?.user.id ?? null });
    }
  });

  async function finishRestore(session: Session | null, error: unknown) {
    if (!active || sdkDecided) return;
    if (!session && isNetworkError(error)) {
      useSessionStore.setState({ sdkStatus: 'offline' });
      const local = await stored;
      if (active && !sdkDecided) settle(local, 'offline');
    } else {
      applySdkSession(session);
    }
  }

  void supabase.auth.getSession().then(
    ({ data: { session }, error }) => finishRestore(session, error),
    (error: unknown) => finishRestore(null, error),
  );

  return () => {
    active = false;
    data.subscription.unsubscribe();
    useSessionStore.setState(emptyState);
  };
}

/**
 * One Supabase auth listener per app, shared by every useSession() caller, so
 * the session is read in a single place instead of once per screen. Attached
 * lazily on the first caller and torn down once the last one goes away.
 */
export function subscribeToSession(): () => void {
  refCount += 1;
  if (refCount === 1) stop = start();

  return () => {
    refCount -= 1;
    if (refCount === 0) {
      stop?.();
      stop = undefined;
    }
  };
}
