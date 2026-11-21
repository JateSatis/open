import { AppState } from 'react-native';

import { probeServer, watchDeviceNetwork, watchRealtimeConnection } from '@/api/connection';
import { createAppQueryClient, syncQueryOnlineState } from '@/lib/queryClient';
import { startConnectionMonitor } from './connectionMonitor';
import { getConnectionStatus, resetConnectionState } from './connectionStore';

jest.mock('@/api/connection', () => ({
  isRealtimeConnected: () => false,
  probeServer: jest.fn(),
  reconnectRealtime: jest.fn(),
  watchDeviceNetwork: jest.fn(() => jest.fn()),
  watchRealtimeConnection: jest.fn(() => jest.fn()),
}));

it('сохраняет подписки, таймер и незавершённую пробу при повторном запуске и смене клиента', async () => {
  jest.useFakeTimers();
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const remove = jest.fn();
  const appState = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  let finish!: (ok: boolean) => void;
  jest.mocked(probeServer).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const oldClient = createAppQueryClient();
  const newClient = createAppQueryClient();
  const oldRefresh = jest.spyOn(oldClient, 'refetchQueries');
  const newRefresh = jest.spyOn(newClient, 'refetchQueries');
  const stop = startConnectionMonitor();
  const detach = syncQueryOnlineState(oldClient, true);
  detach();
  const detachNew = syncQueryOnlineState(newClient, true);
  try {
    expect(startConnectionMonitor()).toBe(stop);
    expect(watchDeviceNetwork).toHaveBeenCalledTimes(1);
    expect(watchRealtimeConnection).toHaveBeenCalledTimes(1);
    expect(appState).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(probeServer).toHaveBeenCalledTimes(1);
    finish(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConnectionStatus()).toBe('online');
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).toHaveBeenCalledTimes(1);

    AppState.currentState = 'background';
    jest.mocked(watchRealtimeConnection).mock.calls[0][0]('down');
    await jest.advanceTimersByTimeAsync(6000);
    expect(probeServer).toHaveBeenCalledTimes(1);
    AppState.currentState = 'active';
    appState.mock.calls[0][1]('active');
    expect(probeServer).toHaveBeenCalledTimes(2);
  } finally {
    detachNew();
    stop();
    AppState.currentState = previous;
    jest.restoreAllMocks();
    resetConnectionState();
    jest.useRealTimers();
  }
  expect(remove).toHaveBeenCalledTimes(1);
  expect(jest.mocked(watchDeviceNetwork).mock.results[0].value).toHaveBeenCalledTimes(1);
  expect(jest.mocked(watchRealtimeConnection).mock.results[0].value).toHaveBeenCalledTimes(1);
});
