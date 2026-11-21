import type { Session } from '@supabase/supabase-js';

import { sessionIdOf } from '@/lib/jwt';
import { useSessionStore } from './sessionState';

export type SessionOwner = { userId: string; sessionId: string };

export function ownerOf(session: Session | null): SessionOwner | null {
  if (!session?.access_token) return null;
  const sessionId = sessionIdOf(session.access_token);
  return sessionId ? { userId: session.user.id, sessionId } : null;
}

export function confirmedSessionOwner(state = useSessionStore.getState()) {
  return state.sdkStatus === 'session' ? ownerOf(state.session) : null;
}

export function sameSession(a: SessionOwner | null, b: SessionOwner | null) {
  return a?.userId === b?.userId && a?.sessionId === b?.sessionId;
}

export function isCurrentSession(owner: SessionOwner) {
  return sameSession(owner, confirmedSessionOwner());
}
