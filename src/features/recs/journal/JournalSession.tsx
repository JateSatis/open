import * as Linking from 'expo-linking';
import { useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  announce,
  appCameForeground,
  appWentBackground,
  enterScreen,
  refineEntry,
  screenOf,
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
  const segments = useSegments();

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
      else if (state === 'active') appCameForeground();
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    journal.setUser(userId);

    if (userId) announce();
  }, [userId]);

  useEffect(() => {
    const { screen, tab } = screenOf(segments);

    enterScreen(screen, tab);
  }, [segments]);

  return null;
}
