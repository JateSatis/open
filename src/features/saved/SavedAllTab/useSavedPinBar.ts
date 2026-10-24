import { useCallback, useMemo } from 'react';

import type { PinnedMessage } from '@/api/pins';
import type { SavedFilterInput } from '@/api/saved';
import { showNotice } from '@/features/notifications/alertsStore';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { useSavedPins } from '@/features/saved/useSavedPins';

/**
 * Полоса закрепов «Все» — та же, что в чате: последний закреп первым, тап
 * ведёт к записи и переключает полосу на предыдущий. Под фильтром — только
 * подходящие закрепы.
 */
export function useSavedPinBar(
  jump: (id: string, seq: number) => Promise<boolean>,
  filter: { input: SavedFilterInput | null; key: string | null },
) {
  const saved = useSavedPins(filter);
  const pins: PinnedMessage[] = useMemo(
    () =>
      saved.map((pin) => ({
        messageId: pin.id,
        forwardId: null,
        messageSeq: pin.seq,
        originalSeq: pin.seq,
        kind: pin.kind,
        text: pin.text,
        thumbnailUrl: pin.thumbnailUrl,
      })),
    [saved],
  );
  const cursor = usePinnedCursor(pins);
  const { advance } = cursor;

  const open = useCallback(
    (pin: PinnedMessage) => {
      advance();
      void jump(pin.messageId, pin.messageSeq)
        .then((found) => {
          if (!found) showNotice('Не удалось найти сообщение', 'error');
        })
        .catch(() => showNotice('Не удалось найти сообщение', 'error'));
    },
    [advance, jump],
  );

  return { pins, index: cursor.index, open };
}
