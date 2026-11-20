import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { useSessionStore } from '@/features/auth/sessionStore';
import { destinationForURL } from './links';
import type { Destination } from './types';

export type IncomingLink = { destination: Destination; owner: string | null; take: () => boolean };

// Lives above the account-keyed query and navigation trees. A signed-out link survives
// sign-in, but a link received by an account cannot be delivered to a different one.
export function useIncomingLink() {
  const [incoming, setIncoming] = useState<IncomingLink | null>(null);
  const latest = useRef<IncomingLink | null>(null);
  useEffect(() => {
    let active = true;
    let received = false;
    const receive = (url: string) => {
      const destination = destinationForURL(url);
      if (!destination || !active) return;
      received = true;
      const link: IncomingLink = {
        destination,
        owner: useSessionStore.getState().localAccountId ?? null,
        take: () => {
          if (latest.current !== link) return false;
          latest.current = null;
          setIncoming(null);
          return true;
        },
      };
      latest.current = link;
      setIncoming(link);
    };
    const unsubscribe = useSessionStore.subscribe(({ localAccountId: owner }) => {
      const link = latest.current;
      if (!link || owner === undefined) return;
      if (link.owner && link.owner !== owner) link.take();
      else if (owner) link.owner = owner;
    });
    const listener = Linking.addEventListener('url', (e) => receive(e.url));
    void Linking.getInitialURL()
      .then((url) => {
        if (url && !received) receive(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
      listener.remove();
    };
  }, []);
  return incoming;
}
