/**
 * Похоже ли это на «запрос не дошёл до сервера».
 *
 * Отличить сетевой сбой от отказа сервера важно: первое лечится ожиданием и
 * повтором, второе — нет. В React Native неудавшийся fetch приходит как
 * TypeError с текстом про сеть, а Supabase заворачивает его в свои классы
 * ошибок, поэтому смотрим и на имя, и на текст.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { name, message } = error as { name?: unknown; message?: unknown };

  if (name === 'AuthRetryableFetchError' || name === 'TypeError') return true;

  return typeof message === 'string' && /network|fetch|internet|timeout|offline/i.test(message);
}

/**
 * Текст ошибки загрузки для интерфейса — или ничего.
 *
 * Обрыв связи отдельным сообщением не показывается: об этом уже говорит
 * заголовок экрана, а рядом с ним красная плашка с `UnknownHostException`
 * пользователю ничего не объясняет. Всё остальное сводится к одной понятной
 * фразе, сырой текст ошибки наружу не попадает.
 */
export function describeLoadError(error: unknown, fallback: string): string | null {
  if (error === null || error === undefined) return null;

  return isNetworkError(error) ? null : fallback;
}
