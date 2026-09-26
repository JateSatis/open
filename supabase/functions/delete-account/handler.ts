/**
 * Удаление аккаунта того, кто вызвал функцию, — и только его.
 *
 * Кого удалять, функция берёт исключительно из JWT вызывающего, проверенного
 * сервером Auth. Тело запроса не читается вовсе: никакой `user_id` из запроса
 * не может направить удаление на другого человека.
 *
 * Зависимости передаются снаружи, чтобы границы можно было проверить
 * Deno-тестом без сети (`handler.test.ts`); настоящие — в `index.ts`.
 */

export type DeleteAccountDeps = {
  /** Проверяет токен у Auth и возвращает id его владельца или null. */
  resolveUserId: (accessToken: string) => Promise<string | null>;
  /** Удаляет файлы аватара. Файлы из переписки не трогает: они часть публичной истории. */
  removeAvatarFiles: (userId: string) => Promise<void>;
  /** `auth.admin.deleteUser`: профиль уходит каскадом, ссылки на него обнуляются. */
  deleteUser: (userId: string) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match ? match[1] : null;
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  const log = deps.log ?? (() => {});

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' });
    }

    const token = bearerToken(request);

    if (!token) {
      return json(401, { error: 'unauthorized' });
    }

    let userId: string | null;

    try {
      userId = await deps.resolveUserId(token);
    } catch (error) {
      log('resolveUserId failed', error);
      return json(401, { error: 'unauthorized' });
    }

    if (!userId) {
      return json(401, { error: 'unauthorized' });
    }

    // Аватар — не часть переписки; неудача здесь не повод оставлять аккаунт.
    try {
      await deps.removeAvatarFiles(userId);
    } catch (error) {
      log('removeAvatarFiles failed', error);
    }

    try {
      await deps.deleteUser(userId);
    } catch (error) {
      log('deleteUser failed', error);
      return json(500, { error: 'delete_failed' });
    }

    return json(200, { deleted: true });
  };
}
