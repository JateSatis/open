import type { AuthError } from '@supabase/supabase-js';

/**
 * Sign-in failures are shown to the user verbatim, so every message says what
 * happened and what to do next. Raw provider errors are in English and leak
 * implementation details, so they are never displayed as is.
 */
export const signInMessages = {
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  generic: 'Не удалось войти. Попробуйте ещё раз.',
  missingToken: 'Провайдер не вернул данные для входа. Попробуйте ещё раз.',
  googleNotConfigured:
    'Вход через Google не настроен в этой сборке. Сообщите нам, мы это починим.',
  googlePlayServices:
    'Для входа через Google нужны сервисы Google Play. Обновите их и попробуйте ещё раз.',
  inProgress: 'Вход уже выполняется.',
  appleUnavailable: 'Вход через Apple доступен только на iPhone и iPad.',
} as const;

function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { name, message } = error as { name?: unknown; message?: unknown };

  return (
    name === 'AuthRetryableFetchError' ||
    (typeof message === 'string' && /network|fetch|internet|timeout/i.test(message))
  );
}

export function describeAuthError(error: AuthError | unknown): string {
  return isNetworkFailure(error) ? signInMessages.network : signInMessages.generic;
}

export function errorCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const { code } = error as { code?: unknown };

  return typeof code === 'string' ? code : null;
}
