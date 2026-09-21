import { onlineManager } from '@tanstack/react-query';

import {
  getConnectionStatus,
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

  it('calls it a lost connection only when a request fails to reach the server', () => {
    reportRealtimeJoined();
    reportRequestFailed();

    expect(getConnectionStatus()).toBe('offline');
  });

  it('says connecting, not offline, when only the socket drops', () => {
    reportRealtimeJoined();
    reportRealtimeDown();

    expect(getConnectionStatus()).toBe('connecting');
  });

  it('counts a request that went through as proof of connection', () => {
    reportRequestFailed();
    reportRequestSucceeded();

    expect(getConnectionStatus()).toBe('online');
  });

  it('stops queries from hammering a network that is not there', () => {
    reportRequestFailed();
    expect(onlineManager.isOnline()).toBe(false);

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

    reportRequestFailed();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('lets a subscriber leave', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToConnectionStatus(listener);

    unsubscribe();
    reportRealtimeJoined();

    expect(listener).not.toHaveBeenCalled();
  });
});
