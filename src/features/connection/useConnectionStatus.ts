import { useSyncExternalStore } from 'react';

import {
  getConnectionStatus,
  subscribeToConnectionStatus,
  type ConnectionStatus,
} from './connectionStore';

/** Состояние связи с сервером. Читается только отсюда. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(
    subscribeToConnectionStatus,
    getConnectionStatus,
    getConnectionStatus,
  );
}
