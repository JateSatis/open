import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

export type SessionState = {
  session: Session | null;
  isAuthenticated: boolean;
  /** True until the persisted session has been read from storage at least once. */
  isLoading: boolean;
};

const emptyState: SessionState = {
  session: null,
  isAuthenticated: false,
  isLoading: true,
};

let state: SessionState = emptyState;
const listeners = new Set<() => void>();
let authSubscription: { unsubscribe: () => void } | null = null;

function emit(next: SessionState) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function settle(session: Session | null) {
  emit({ session, isAuthenticated: session !== null, isLoading: false });
}

function start() {
  // onAuthStateChange has to be attached before the first read, otherwise a
  // token refresh finishing mid-read would be dropped and the store would keep
  // a session that is already stale.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    settle(session);
  });
  authSubscription = data.subscription;

  void supabase.auth.getSession().then(({ data: { session } }) => {
    // onAuthStateChange may have delivered a fresher session already.
    if (state.isLoading) {
      settle(session);
    }
  });
}

function stop() {
  authSubscription?.unsubscribe();
  authSubscription = null;
  state = emptyState;
}

export function getSessionState(): SessionState {
  return state;
}

/**
 * One Supabase auth listener per app, shared by every useSession() caller, so
 * the session is read in a single place instead of once per screen.
 */
export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);

  if (authSubscription === null) {
    start();
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      stop();
    }
  };
}
