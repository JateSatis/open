import { requestClient } from '@/api/requestClient';
import type { AccountClient } from '@/api/accountClient';
import { recordJournalEvents, type JournalWireEvent } from '@/api/recJournal';
import { ownerOf } from '@/features/auth/sessionOwner';
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

  let bound: AccountClient | undefined;
  let sender: ((events: JournalWireEvent[]) => ReturnType<typeof recordJournalEvents>) | undefined;
  function sync() {
    const state = useSessionStore.getState();
    const api = requestClient();
    if (bound !== api) {
      bound = api;
      sender = events => recordJournalEvents(events, api);
    }
    const sessionId = ownerOf(state.session)?.sessionId ?? state.localSessionId;
    setSessionUser(sessionId ? state.localAccountId ?? null : null, Date.now(), sessionId ?? undefined);
    journal.setDeliveryUser(getConnectionStatus() === 'online' ? confirmedAccountId(state) : null, sender);
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
