import { requestClient } from '@/api/requestClient';
import { MutationCache, onlineManager, type Query, QueryCache, QueryClient } from '@tanstack/react-query';

import { ChatGoneError } from '@/api/chatGone';
import { ProfileUnavailableError } from '@/api/profileErrors';
import {
  getConnectionStatus,
  reportRequestFailed,
  reportRequestSucceeded,
  subscribeToConnectionStatus,
} from '@/features/connection/connectionStore';
import { isNetworkError } from '@/lib/network';
import { requireAccountSession } from '@/features/auth/sessionState';

const QUERY_RETRY_DELAY_MS = 1000;
// Только успешный queryFn закрывает обновление после обрыва. Оптимистичная
// запись или частичное событие Realtime тоже меняют кеш, но не заменяют чтение.
const fetchedSinceDisconnect = new WeakSet<object>();

// У персонального канала есть свой цикл переподписки. Снимок списка после
// SUBSCRIBED захватывает также сообщения между восстановлением HTTP и канала.
const USER_CHANNEL_WAIT_MS = 6000;
type UserChannel = { pending: boolean; fallback?: ReturnType<typeof setTimeout> };
const userChannels = new WeakMap<QueryClient, UserChannel>();

function cancelFallback(channel?: UserChannel) {
  if (!channel) return;
  clearTimeout(channel.fallback);
  channel.fallback = undefined;
}

function shouldRefresh(client: QueryClient, query: Pick<Query, 'meta'>) {
  const waitingForJoin = query.meta?.refreshOnUserChannelJoin && userChannels.get(client)?.pending;
  return !waitingForJoin && !query.meta?.localOnly && !fetchedSinceDisconnect.has(query);
}

export function bindUserChannel(client: QueryClient) {
  const channel: UserChannel = { pending: true };
  userChannels.set(client, channel);
  return {
    joined() {
      channel.pending = false;
      cancelFallback(channel);
    },
    disconnected() {
      channel.pending = true;
    },
    dispose() {
      cancelFallback(channel);
      userChannels.delete(client);
    },
  };
}

function reportOutcome(error: unknown | null) {
  if (error === null) {
    reportRequestSucceeded();
    return;
  }

  if (isNetworkError(error)) {
    reportRequestFailed();
  }
}

export function syncQueryOnlineState(client: QueryClient, requestsReady: boolean) {
  const sync = () => {
    const status = getConnectionStatus();
    const channel = userChannels.get(client);
    if (!requestsReady || status !== 'online') {
      cancelFallback(channel);
      if (channel && status === 'offline') channel.pending = true;
      for (const query of client.getQueryCache().getAll()) fetchedSinceDisconnect.delete(query);
    }
    onlineManager.setOnline(requestsReady && status !== 'offline');
    if (requestsReady && status === 'online') {
      void client.invalidateQueries(
        { predicate: (query) => shouldRefresh(client, query) },
        { cancelRefetch: false },
      );
      if (channel?.pending && !channel.fallback) {
        // HTTP работает и при недоступном Realtime. Поздний реальный SUBSCRIBED
        // отдельно дочитает события, пропущенные уже после этого снимка.
        channel.fallback = setTimeout(() => {
          channel.fallback = undefined;
          void client.invalidateQueries(
            { predicate: (query) => !!query.meta?.refreshOnUserChannelJoin && !fetchedSinceDisconnect.has(query) },
            { cancelRefetch: false },
          );
        }, USER_CHANNEL_WAIT_MS);
      }
    }
  };
  sync();
  const unsubscribe = subscribeToConnectionStatus(sync);
  return () => {
    unsubscribe();
    cancelFallback(userChannels.get(client));
  };
}

export function createAppQueryClient(owner: string | null = null, api = requestClient()) {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // После разрыва перечитываем даже свежий кеш. Если подтверждение сервера
        // уже обновило запрос, отложенное событие onlineManager пропускает его.
        refetchOnReconnect: (query) => shouldRefresh(client, query) ? 'always' : false,
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
      onSuccess: (_data, query) => {
        if (query.meta?.localOnly) return;
        fetchedSinceDisconnect.add(query);
        if (api === requestClient()) reportOutcome(null);
      },
      onError: (error, query) => {
        if (!query.meta?.localOnly && api === requestClient()) reportOutcome(error);
      },
    }),
    mutationCache: new MutationCache({
      onMutate: () => requireAccountSession(owner, api),
      onSuccess: () => { if (api === requestClient()) reportOutcome(null); },
      onError: (error) => { if (api === requestClient()) reportOutcome(error); },
    }),
  });
  return client;
}
