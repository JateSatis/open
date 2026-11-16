import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ChatGoneError } from '@/api/chatGone';
import { ProfileUnavailableError } from '@/api/profileErrors';
import { reportRequestFailed, reportRequestSucceeded } from '@/features/connection/connectionStore';
import { isNetworkError } from '@/lib/network';

const QUERY_RETRY_DELAY_MS = 1000;

/**
 * Обычные запросы и мутации дают сигнал о связи с сервером. При отключённом
 * сокете useConnectionWatch также проверяет доступность сервера через probeServer().
 */
function reportOutcome(error: unknown | null) {
  if (error === null) {
    reportRequestSucceeded();
    return;
  }

  if (isNetworkError(error)) {
    reportRequestFailed();
  }
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Вернулась связь — данные перечитываются, даже если запрос сам по
        // себе ещё не считается устаревшим.
        refetchOnReconnect: 'always',
        // Одна тихая повторная попытка вслед за первой: со сроком запроса
        // (`REQUEST_TIMEOUT_MS`) это около 20 с до того, как экран честно
        // скажет «не удалось загрузить», вместо минуты с лишним по умолчанию.
        // Удалённый чат и недоступный профиль от повтора не вернутся — сразу
        // «Чат удалён» и «Пользователь недоступен».
        retry: (failures, error) =>
          !(error instanceof ChatGoneError) &&
          !(error instanceof ProfileUnavailableError) &&
          failures < 1,
        retryDelay: QUERY_RETRY_DELAY_MS,
      },
    },
    queryCache: new QueryCache({
      onSuccess: () => reportOutcome(null),
      onError: (error) => reportOutcome(error),
    }),
    mutationCache: new MutationCache({
      onSuccess: () => reportOutcome(null),
      onError: (error) => reportOutcome(error),
    }),
  });
}
