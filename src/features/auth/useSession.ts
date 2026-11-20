import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  subscribeToSession,
  useSessionStore,
  type AuthBootstrap,
  type SessionState,
} from './sessionStore';

export type { AuthBootstrap, SessionState };
export function useSession(): SessionState {
  useEffect(() => subscribeToSession(), []);

  return useSessionStore(
    useShallow(({ session, isAuthenticated, isLoading }) => ({ session, isAuthenticated, isLoading })),
  );
}

export function useAuthBootstrap(): AuthBootstrap {
  useEffect(() => subscribeToSession(), []);
  return useSessionStore(
    useShallow(({ localAccountId, sdkStatus }) => ({ localAccountId, sdkStatus })),
  );
}
