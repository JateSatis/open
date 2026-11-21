import { AppState } from 'react-native';

import {
  isRealtimeConnected,
  probeServer,
  reconnectRealtime,
  watchDeviceNetwork,
  watchRealtimeConnection,
} from '@/api/connection';
import {
  getConnectionStatus,
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  reportRequestFailed,
  reportRequestSucceeded,
} from './connectionStore';

const CHECK_INTERVAL_MS = 1000;
const CALM_FACTOR = 6;
let stopMonitor: (() => void) | undefined;

export function startConnectionMonitor() {
  if (stopMonitor) return stopMonitor;

  let stopped = false;
  let probing = false;
  let ticks = 0;

  async function check() {
    if (stopped || AppState.currentState !== 'active') return;
    if (isRealtimeConnected()) {
      reportRealtimeJoined();
      return;
    }

    // Когда связь подтверждена или устройство без сети, достаточно редкой пробы.
    ticks += 1;
    if (probing || (getConnectionStatus() !== 'connecting' && ticks % CALM_FACTOR !== 0)) return;

    probing = true;
    try {
      reconnectRealtime();
      const reachable = await probeServer();
      if (stopped) return;
      if (reachable) {
        reportRequestSucceeded();
        reconnectRealtime();
      } else {
        reportRequestFailed();
      }
    } finally {
      probing = false;
    }
  }

  const stopDevice = watchDeviceNetwork((connected) => {
    if (stopped) return;
    reportDeviceNetwork(connected);
    if (connected) void check();
  });
  const stopHeartbeat = watchRealtimeConnection((state) => {
    if (state === 'joined') reportRealtimeJoined();
    else reportRealtimeDown();
  });
  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void check();
  });

  stopMonitor = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    appState.remove();
    stopDevice();
    stopHeartbeat();
    stopMonitor = undefined;
  };
  void check();
  return stopMonitor;
}
