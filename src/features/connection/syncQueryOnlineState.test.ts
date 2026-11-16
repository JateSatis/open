import { onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';

import { reportDeviceNetwork, reportRealtimeJoined, resetConnectionState } from './connectionStore';
import { syncQueryOnlineState } from './syncQueryOnlineState';

afterEach(() => {
  resetConnectionState();
  onlineManager.setOnline(true);
});

it('сразу ставит запрос на паузу в offline и возобновляет его уже в connecting', async () => {
  reportDeviceNetwork(false);
  const stopSync = syncQueryOnlineState();
  const client = new QueryClient();
  client.mount();
  const queryFn = jest.fn().mockResolvedValue('ok');
  const observer = new QueryObserver(client, { queryKey: ['chats'], queryFn, gcTime: Infinity });
  const stopObserving = observer.subscribe(() => {});

  try {
    const result = observer.refetch();
    expect(observer.getCurrentResult().fetchStatus).toBe('paused');
    expect(queryFn).not.toHaveBeenCalled();

    reportDeviceNetwork(true);
    expect((await result).data).toBe('ok');
    expect(queryFn).toHaveBeenCalledTimes(1);

    reportDeviceNetwork(false);
    expect(onlineManager.isOnline()).toBe(false);
    reportRealtimeJoined();
    expect(onlineManager.isOnline()).toBe(true);
  } finally {
    stopObserving();
    client.unmount();
    client.clear();
    stopSync();
  }
});

it('пропускает изменения после отписки и применяет текущий статус при новом подключении', () => {
  const stopSync = syncQueryOnlineState();
  stopSync();
  reportDeviceNetwork(false);
  expect(onlineManager.isOnline()).toBe(true);

  const stopNewSync = syncQueryOnlineState();
  try {
    expect(onlineManager.isOnline()).toBe(false);
    reportDeviceNetwork(true);
    expect(onlineManager.isOnline()).toBe(true);
  } finally {
    stopNewSync();
  }
});
