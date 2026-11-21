import { onlineManager, type QueryClient, QueryObserver } from '@tanstack/react-query';

import { bindUserChannel, createAppQueryClient, syncQueryOnlineState } from '@/lib/queryClient';
import {
  getConnectionStatus,
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  resetConnectionState,
} from './connectionStore';

function observeChats(client: QueryClient, queryFn: () => Promise<string>) {
  const observer = new QueryObserver(client, {
    queryKey: ['chats'], queryFn, initialData: 'локальный', staleTime: Infinity,
    gcTime: Infinity, retry: false,
  });
  return observer.subscribe(() => {});
}

let client: QueryClient;
beforeEach(() => {
  jest.useFakeTimers();
  client = createAppQueryClient();
  client.mount();
  reportRealtimeJoined();
});
afterEach(() => {
  client.unmount();
  client.clear();
  resetConnectionState();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

it('возобновляет запрос в connecting и один раз обновляет свежий открытый список', async () => {
  const stop = syncQueryOnlineState(client, true);
  const list = jest.fn(async () => {
    expect(getConnectionStatus()).toBe('connecting');
    return 'с сервера';
  });
  const unsubscribe = observeChats(client, list);
  try {
    expect(list).not.toHaveBeenCalled();
    reportDeviceNetwork(false);
    const pending = client.fetchQuery({ queryKey: ['chats'], queryFn: list });
    expect(client.getQueryState(['chats'])?.fetchStatus).toBe('paused');
    expect(list).not.toHaveBeenCalled();
    expect(client.getQueryData(['chats'])).toBe('локальный');

    reportDeviceNetwork(true);
    expect(onlineManager.isOnline()).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe('с сервера');
    reportRealtimeJoined();
    reportRealtimeJoined();
    await jest.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(['chats'])).toBe('с сервера');
    expect(list).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    stop();
  }
});

it('повторяет неудавшийся ранний запрос при подтверждении сервера', async () => {
  const stop = syncQueryOnlineState(client, true);
  const list = jest.fn().mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValue('с сервера');
  const unsubscribe = observeChats(client, list);
  try {
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConnectionStatus()).toBe('connecting');
    expect(list).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['chats'])).toBe('локальный');
    reportRealtimeJoined();
    await jest.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(['chats'])).toBe('с сервера');
    expect(list).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    stop();
  }
});

it('обновляет историю после восстановления сокета, даже если кеш успел измениться локально', async () => {
  const stop = syncQueryOnlineState(client, true);
  const load = jest.fn().mockResolvedValue('полная история');
  const history = new QueryObserver(client, {
    queryKey: ['history'], queryFn: load, initialData: 'сохранённая история',
    staleTime: Infinity, gcTime: Infinity, refetchOnReconnect: false,
  });
  const unsubscribe = history.subscribe(() => {});
  try {
    reportRealtimeDown();
    client.setQueryData(['history'], 'локальная правка');
    expect(load).not.toHaveBeenCalled();
    reportRealtimeJoined();
    reportRealtimeJoined();
    await jest.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['history'])).toBe('полная история');
  } finally {
    unsubscribe();
    stop();
  }
});

it('отсоединяет прежний клиент и применяет к новому текущую готовность сессии', async () => {
  const oldList = jest.fn().mockResolvedValue('старый');
  const stopOld = syncQueryOnlineState(client, true);
  const unsubscribeOld = observeChats(client, oldList);
  reportDeviceNetwork(false);
  stopOld();
  unsubscribeOld();
  client.unmount();
  client.clear();

  client = createAppQueryClient();
  client.mount();
  const list = jest.fn().mockResolvedValue('новый');
  let stop = syncQueryOnlineState(client, false);
  const unsubscribe = observeChats(client, list);
  try {
    reportDeviceNetwork(true);
    reportRealtimeJoined();
    await jest.advanceTimersByTimeAsync(0);
    expect(onlineManager.isOnline()).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(client.getQueryData(['chats'])).toBe('локальный');

    stop();
    stop = syncQueryOnlineState(client, true);
    expect(onlineManager.isOnline()).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['chats'])).toBe('новый');
    expect(oldList).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    stop();
  }
});

it('обновляет открытый список по HTTP, если персональный канал так и не вернулся', async () => {
  const stop = syncQueryOnlineState(client, true);
  const channel = bindUserChannel(client);
  channel.joined();
  const load = jest.fn().mockResolvedValue('с сервера');
  const observer = new QueryObserver(client, {
    queryKey: ['chats'], queryFn: load, initialData: 'локальный', staleTime: Infinity,
    gcTime: Infinity, meta: { refreshOnUserChannelJoin: true },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);
    reportRealtimeJoined();
    await jest.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(6000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['chats'])).toBe('с сервера');
  } finally {
    unsubscribe();
    stop();
    channel.dispose();
  }
});
