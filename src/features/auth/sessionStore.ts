import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

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

export const useSessionStore = create<SessionState>(() => emptyState);

let authSubscription: { unsubscribe: () => void } | null = null;
let refCount = 0;

function settle(session: Session | null) {
  useSessionStore.setState({ session, isAuthenticated: session !== null, isLoading: false });
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
    if (useSessionStore.getState().isLoading) {
      settle(session);
    }
  });
}

function stop() {
  authSubscription?.unsubscribe();
  authSubscription = null;
  useSessionStore.setState(emptyState);
}

/**
 * One Supabase auth listener per app, shared by every useSession() caller, so
 * the session is read in a single place instead of once per screen. Attached
 * lazily on the first caller and torn down once the last one goes away.
 */
export function subscribeToSession(): () => void {
  refCount += 1;
  if (refCount === 1) start();

  return () => {
    refCount -= 1;
    if (refCount === 0) stop();
  };
}
