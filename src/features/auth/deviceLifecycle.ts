import { requestClient } from '@/api/requestClient';
import { AppState } from 'react-native';

import { registerDevice, touchDevice } from '@/api/account';
import { markSeen } from '@/api/chatInfo';
import { isNetworkError } from '@/lib/network';
import { currentDeviceInfo } from './deviceInfo';
import { getInstallationId } from './installationId';
import { withSessionChange } from './sessionChange';
import { confirmedSessionOwner, isCurrentSession, sameSession, type SessionOwner } from './sessionOwner';
import { useSessionStore } from './sessionState';
import { signOutQuietly } from './signOut';

const SEEN_INTERVAL_MS = 60_000;

function report(operation: string, error: unknown) {
  if (__DEV__ && !isNetworkError(error)) console.warn(operation, error);
}

function bindDevice(owner: SessionOwner) {
  const api = requestClient();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const current = () => !stopped && isCurrentSession(owner);

  async function check(register: boolean) {
    let alive = true;
    try {
      const installation = await getInstallationId();
      if (!current()) return;
      alive = await touchDevice(installation, owner, api);
    } catch (error) {
      report('touch_device:', error);
    }
    if (!current()) return;
    if (!alive) {
      await signOutQuietly(owner);
    } else if (register) {
      const info = await currentDeviceInfo();
      // Регистрация заменяет прежний сеанс этой установки на сервере.
      await withSessionChange(async () => {
        if (current()) await registerDevice(info, owner, api);
      });
    }
  }

  function seen(online: boolean) {
    if (current()) void markSeen(online, owner, api).catch(error => report('mark_seen:', error));
  }

  function startHeartbeat() {
    seen(true);
    timer ??= setInterval(() => seen(true), SEEN_INTERVAL_MS);
  }

  void check(true).catch(error => report('device lifecycle:', error));
  if (AppState.currentState === 'active') startHeartbeat();
  const subscription = AppState.addEventListener('change', state => {
    if (!current()) return;
    if (state === 'active') {
      startHeartbeat();
      void check(false).catch(error => report('device lifecycle:', error));
    } else if (state === 'background') {
      clearInterval(timer);
      timer = undefined;
      seen(false);
    }
  });

  return () => {
    stopped = true;
    subscription.remove();
    clearInterval(timer);
  };
}

export function startDeviceLifecycle() {
  let bound: SessionOwner | null = null;
  let stop: (() => void) | undefined;
  function sync() {
    const owner = confirmedSessionOwner();
    if (sameSession(bound, owner)) return;
    stop?.();
    bound = owner;
    stop = owner ? bindDevice(owner) : undefined;
  }
  const unsubscribe = useSessionStore.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    stop?.();
  };
}
