import { onlineManager } from '@tanstack/react-query';

import {
  getConnectionStatus,
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  reportRequestFailed,
  reportRequestSucceeded,
  resetConnectionState,
  subscribeToConnectionStatus,
} from './connectionStore';

beforeEach(() => {
  resetConnectionState();
});

describe('connectionStore', () => {
  it('starts out connecting, not online and not broken', () => {
    expect(getConnectionStatus()).toBe('connecting');
  });

  it('is online while the realtime socket holds', () => {
    reportRealtimeJoined();

    expect(getConnectionStatus()).toBe('online');
  });

  it('calls a silent server a reconnection, not a missing network', () => {
    reportRealtimeJoined();
    reportRequestFailed();

    // «Нет сети» — это про устройство. Сервер может молчать и при живой сети,
    // и тогда честный ответ — «подключаемся».
    expect(getConnectionStatus()).toBe('connecting');
  });

  it('says connecting, not offline, when only the socket drops', () => {
    reportRealtimeJoined();
    reportRealtimeDown();

    expect(getConnectionStatus()).toBe('connecting');
  });

  it('counts a request that went through as proof of connection', () => {
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);
    reportRequestSucceeded();

    expect(getConnectionStatus()).toBe('online');
  });

  it('stops queries from hammering a network that is not there', () => {
    reportDeviceNetwork(false);
    expect(onlineManager.isOnline()).toBe(false);

    reportDeviceNetwork(true);
    reportRealtimeJoined();
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('wakes subscribers on a change and stays quiet otherwise', () => {
    const listener = jest.fn();
    subscribeToConnectionStatus(listener);

    reportRealtimeJoined();
    expect(listener).toHaveBeenCalledTimes(1);

    reportRealtimeJoined();
    expect(listener).toHaveBeenCalledTimes(1);

    reportDeviceNetwork(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('lets a subscriber leave', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToConnectionStatus(listener);

    unsubscribe();
    reportRealtimeJoined();

    expect(listener).not.toHaveBeenCalled();
  });

  it('believes the system at once when the device says there is no network', () => {
    reportRealtimeJoined();
    reportDeviceNetwork(false);

    // Живой сокет из прошлого не спорит с фактом: сети нет.
    expect(getConnectionStatus()).toBe('offline');
  });

  it('does not call itself online just because the device found a network', () => {
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);

    // Wi-Fi без выхода наружу — обычное дело, сервер ещё надо проверить.
    expect(getConnectionStatus()).toBe('connecting');
  });

  it('comes back online when the server answers after the network returns', () => {
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);
    reportRequestSucceeded();

    expect(getConnectionStatus()).toBe('online');
  });

  it('trusts a request that went through over a system that still says offline', () => {
    reportDeviceNetwork(false);
    reportRequestSucceeded();

    // Система сообщает о возвращении сети с задержкой, а удачный запрос — это
    // уже случившийся факт связи.
    expect(getConnectionStatus()).toBe('online');
  });
});
