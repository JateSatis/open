/**
 * Поле `session_id` из access-токена Supabase. Токен здесь не проверяется —
 * это делает сервер; клиенту нужно лишь заметить, что сеанс сменился.
 */
export function sessionIdOf(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];

  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims: unknown = JSON.parse(atob(padded));

    if (typeof claims !== 'object' || claims === null) return null;

    const { session_id: sessionId } = claims as { session_id?: unknown };

    return typeof sessionId === 'string' ? sessionId : null;
  } catch {
    return null;
  }
}
