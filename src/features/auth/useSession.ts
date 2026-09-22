import { useEffect } from 'react';

import { subscribeToSession, useSessionStore, type SessionState } from './sessionStore';

export type { SessionState };

/**
 * The only place auth state is read from. Components never call
 * supabase.auth.getSession() themselves.
 */
export function useSession(): SessionState {
  useEffect(() => subscribeToSession(), []);

  return useSessionStore();
}
