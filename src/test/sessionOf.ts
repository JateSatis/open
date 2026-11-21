import type { Session } from '@supabase/supabase-js';

export function sessionOf(userId: string, sessionId: string, issuedAt = 1): Session {
  const payload = btoa(JSON.stringify({ sub: userId, session_id: sessionId, iat: issuedAt }));
  return { user: { id: userId }, access_token: `header.${payload}.signature` } as Session;
}
