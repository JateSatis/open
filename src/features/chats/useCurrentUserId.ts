import { useEffect, useState } from 'react';

import { getCurrentUserId } from '@/api/chats';

/**
 * The signed-in user's id.
 *
 * Temporary home: `useSession` in `src/features/auth` owns session state but
 * does not expose the user yet. Once it does, this hook reads from there
 * instead — components still must not touch `supabase.auth` themselves.
 */
export function useCurrentUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getCurrentUserId()
      .then((id) => {
        if (active) setUserId(id);
      })
      .catch(() => {
        if (active) setUserId(null);
      });

    return () => {
      active = false;
    };
  }, []);

  return userId;
}
