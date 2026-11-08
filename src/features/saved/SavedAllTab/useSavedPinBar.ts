import { useMemo } from 'react';

import type { PinnedMessage } from '@/api/pins';
import type { SavedFilterInput } from '@/api/saved';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { useSavedPins } from '@/features/saved/useSavedPins';

/**
 * Полоса закрепов «Все» — та же, что в чате: последний закреп первым, тап
 * переключает полосу на предыдущий закреп. Под фильтром — только
 * подходящие закрепы.
 */
export function useSavedPinBar(
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
  return { pins, index: cursor.index, open: cursor.advance };
}
