import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { setPresenceVisible, subscribeToOnlineUsers } from '@/api/chats';

/**
 * Ids of users currently present in the app, from a Realtime Presence channel.
 * Empty until the presence channel syncs, so callers must treat "not listed"
 * as "unknown or offline", never as a hard fact.
 *
 * Свёрнутое приложение снимает меня из Presence: сокет в фоне ещё живёт, и
 * без этого я оставался бы «в сети» вместо «был(а) в …».
 */
export function useOnlineUsers(userId: string | null): Set<string> {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToOnlineUsers(userId, (ids) => setOnlineIds(new Set(ids)));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') setPresenceVisible(true);
      if (state === 'background') setPresenceVisible(false);
    });

    return () => {
      appState.remove();
      unsubscribe();
      setOnlineIds(new Set());
    };
  }, [userId]);

  return onlineIds;
}
