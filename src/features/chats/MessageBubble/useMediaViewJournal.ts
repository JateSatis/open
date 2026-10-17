import { useEffect, useRef } from 'react';

import { logMediaView } from '@/features/recs/journal/chatJournal';

/**
 * Просмотр медиа облачка в журнале: открыли с плитки — сколько смотрели,
 * что и с какого места. Комментарии не пишутся (`messageId` нет).
 */
export function useMediaViewJournal(
  open: { index: number } | null,
  messageId: string | undefined,
  kinds: ('photo' | 'video')[],
) {
  const started = useRef<{ at: number; index: number } | null>(null);
  const kindsRef = useRef(kinds);

  useEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);

  const index = open?.index ?? null;

  useEffect(() => {
    if (!messageId) return;

    if (index !== null) {
      started.current = { at: Date.now(), index };
      return;
    }

    const session = started.current;

    started.current = null;

    if (session) {
      logMediaView(messageId, {
        ms: Date.now() - session.at,
        kind: kindsRef.current[session.index] ?? 'photo',
        index: session.index,
      });
    }
  }, [index, messageId]);
}
