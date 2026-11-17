import * as Linking from 'expo-linking';
import * as Network from 'expo-network';
import { navigationRef, useCurrentScreen } from '@/navigation';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  announce,
  appCameForeground,
  appWentBackground,
  enterScreen,
  leaveScreen,
  refineEntry,
  startAppSession,
} from './appSession';
import { startDeviceWatch } from './device';
import { journal } from './journal';

import { useSession } from '@/features/auth/useSession';

/** Ссылка, которой запустили dev build, — не вход по ссылке. */
function isAppLink(url: string | null): boolean {
  return url !== null && !url.includes('expo-development-client');
}

/**
 * Ничего не рисует. Журнал рекомендаций на уровне приложения: от чьего имени
 * писать, сессия приложения, передний план и фон, время на экранах.
 */
export function JournalSession() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { name, screen, tab } = useCurrentScreen();

  useEffect(() => {
    startDeviceWatch();
    startAppSession('cold');
    void Linking.getInitialURL()
      .then((url) => {
        if (isAppLink(url)) refineEntry('link');
      })
      .catch(() => undefined);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') appWentBackground();
      else if (state === 'active') {
        appCameForeground();
        journal.kick();
      }
    });
    // Сеть вернулась — накопленное без неё уходит сразу, а не по паузе повтора.
    let connected = true;
    const network = Network.addNetworkStateListener(({ isConnected }) => {
      if (isConnected && !connected) journal.kick();
      connected = isConnected !== false;
    });

    return () => {
      subscription.remove();
      network.remove();
    };
  }, []);

  useEffect(() => {
    journal.setUser(userId);

    if (userId) announce(userId);
    return () => {
      leaveScreen();
      journal.setUser(null);
    };
  }, [userId]);

  useEffect(() => {
    if (screen && navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === name)
      enterScreen(screen, tab);
  }, [name, screen, tab, userId]);

  return null;
}
