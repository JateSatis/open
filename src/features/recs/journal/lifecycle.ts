import { getLinkingURL } from 'expo-linking';
import { AppState } from 'react-native';

import { confirmedAccountId, useSessionStore } from '@/features/auth/sessionState';
import {
  getConnectionStatus,
  subscribeToConnectionStatus,
} from '@/features/connection/connectionStore';
import {
  appCameForeground,
  appWentBackground,
  setSessionUser,
  startAppSession,
} from './appSession';
import { startDeviceWatch } from './device';
import { journal } from './journal';

let started = false;

/** Подписки живут столько же, сколько JS-процесс и его очередь. */
export function startJournalLifecycle(launchedAt: number) {
  if (started) return;
  started = true;
  const url = getLinkingURL();
  startAppSession(url && !url.includes('expo-development-client') ? 'link' : 'cold', launchedAt);
  startDeviceWatch();

  function sync() {
    const state = useSessionStore.getState();
    setSessionUser(state.localAccountId ?? null);
    journal.setDeliveryUser(getConnectionStatus() === 'online' ? confirmedAccountId(state) : null);
  }
  useSessionStore.subscribe(sync);
  subscribeToConnectionStatus(sync);
  sync();

  function background() {
    appWentBackground();
    void journal.persist();
  }
  if (AppState.currentState === 'background') background();
  AppState.addEventListener('change', (state) => {
    if (state === 'background') background();
    else if (state === 'active') {
      appCameForeground();
      journal.kick();
    }
  });
}
