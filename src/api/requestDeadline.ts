// Срок на каждый запрос к Supabase. Без него запрос, на который сервер принял
// соединение и молчит (фильтрация, умерший VPN, сеть без выхода наружу),
// висит столько, сколько решит ОС, — а вместе с ним крутилка на экране и всё,
// что этот запрос ждёт. Обёртка стоит в `global.fetch` клиента, поэтому
// покрывает PostgREST, Storage, Functions и обновление токена в Auth: его
// повисание держало бы `getSession()`, а его ждёт каждый запрос.

import { DeadlineError } from '@/lib/deadline';

/**
 * Обычный запрос. Вместе с одним повтором React Query (см. `_layout.tsx`)
 * даёт около 20 с от открытия экрана до «не удалось загрузить».
 */
export const REQUEST_TIMEOUT_MS = 9_000;
/**
 * Edge Functions: токен звонка ходит в LiveKit и обратно, это заметно дольше
 * запроса в базу. Повторов у них нет — человек ждёт одну попытку.
 */
export const FUNCTION_TIMEOUT_MS = 20_000;
/**
 * Загрузка файла в Storage: видео бывает на десятки мегабайт, и на медленной
 * сети оно честно едет минутами. Срок только страхует от вечного зависания.
 */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;

  return input.url;
}

export function timeoutFor(input: FetchInput, init?: FetchInit): number {
  const url = urlOf(input);

  if (url.includes('/functions/v1/')) return FUNCTION_TIMEOUT_MS;

  // Файл уходит телом-буфером; служебные запросы Storage (подпись, удаление,
  // список) — JSON-строкой, им хватает обычного срока.
  const body = init?.body;

  if (url.includes('/storage/v1/') && body != null && typeof body !== 'string') {
    return UPLOAD_TIMEOUT_MS;
  }

  return REQUEST_TIMEOUT_MS;
}

/**
 * `fetch`, который не ждёт ответа дольше срока. Не уложился — `DeadlineError`
 * (для `isNetworkError` это сбой связи, а не отказ сервера). Свой `signal`
 * вызывающего уважается: его отмена обрывает запрос как и раньше, с его
 * собственной ошибкой.
 *
 * Сигналы объединяются вручную: `AbortSignal.any` в Hermes нет.
 */
export function withRequestDeadline(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal ?? undefined;
    let expired = false;

    const timer = setTimeout(
      () => {
        expired = true;
        controller.abort();
      },
      timeoutFor(input, init),
    );
    const forward = () => controller.abort();

    if (outer?.aborted) controller.abort();
    else outer?.addEventListener('abort', forward);

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (expired) throw new DeadlineError();

      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    }
  };
}
