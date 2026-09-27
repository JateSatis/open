import { useCallback, useState } from 'react';

import type { PinnedMessage } from '@/api/pins';

export type PinnedCursor = {
  /** Какой закреп показывать в полосе. */
  index: number;
  /** После прыжка полоса переключается на предыдущее закреплённое; с самого старого — снова на новое. */
  advance: () => void;
};

/**
 * Какой из закрепов в полосе. Сначала — самый новый, как в Telegram.
 * Помнится само сообщение, а не номер: закрепы меняются в реальном времени,
 * и номер съехал бы на соседнее.
 */
export function usePinnedCursor(pins: PinnedMessage[]): PinnedCursor {
  const [shownId, setShownId] = useState<string | null>(null);
  const found = shownId ? pins.findIndex((pin) => pin.messageId === shownId) : -1;
  const index = found === -1 ? pins.length - 1 : found;

  const advance = useCallback(() => {
    if (pins.length === 0) return;

    const previous = index - 1 >= 0 ? index - 1 : pins.length - 1;

    setShownId(pins[previous].messageId);
  }, [index, pins]);

  return { index, advance };
}
