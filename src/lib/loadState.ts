import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Что показать на месте данных запроса:
 * - `ready` — данные есть (даже если обновление в фоне упало: старое лучше пустого);
 * - `paused` — устройство без сети, запрос ждёт её и сам не начнётся;
 * - `loading` — идёт попытка, в том числе тихий повтор;
 * - `failed` — показать нечего, а все попытки не удались.
 */
export type LoadState = 'ready' | 'paused' | 'loading' | 'failed';

type QueryLike = {
  data: unknown;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
};

export function loadStateOf({ data, status, fetchStatus }: QueryLike): LoadState {
  if (data !== undefined) return 'ready';
  if (fetchStatus === 'paused') return 'paused';
  if (fetchStatus === 'fetching') return 'loading';

  return status === 'error' ? 'failed' : 'loading';
}

/**
 * «Повторить» на экране сбоя: заново с нуля те запросы, которым показать
 * нечего. Именно сброс, а не `refetch`: у запроса без данных новый `refetch`
 * присоединяется к текущей попытке, а не начинает свою (query-core,
 * `Query.fetch`), и кнопка ждала бы ту же повисшую попытку. Запросы с данными
 * не трогаются — их сброс стёр бы то, что уже на экране.
 */
export function reloadMissing(queryClient: QueryClient, keys: readonly QueryKey[]) {
  for (const queryKey of keys) {
    if (queryClient.getQueryData(queryKey) !== undefined) continue;

    void queryClient.resetQueries({ queryKey, exact: true });
  }
}
