import { useSyncExternalStore } from 'react';

import { getSessionState, subscribeToSession, type SessionState } from './sessionStore';

export type { SessionState };

/**
 * The only place auth state is read from. Components never call
 * supabase.auth.getSession() themselves.
 */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribeToSession, getSessionState, getSessionState);
}
