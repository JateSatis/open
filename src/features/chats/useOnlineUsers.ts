import { useEffect, useState } from 'react';

import { subscribeToOnlineUsers } from '@/api/chats';

/**
 * Ids of users currently present in the app, from a Realtime Presence channel.
 * Empty until the presence channel syncs, so callers must treat "not listed"
 * as "unknown or offline", never as a hard fact.
 */
export function useOnlineUsers(userId: string | null): Set<string> {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) return;

    const unsubscribe = subscribeToOnlineUsers(userId, (ids) => setOnlineIds(new Set(ids)));

    return () => {
      unsubscribe();
      setOnlineIds(new Set());
    };
  }, [userId]);

  return onlineIds;
}
