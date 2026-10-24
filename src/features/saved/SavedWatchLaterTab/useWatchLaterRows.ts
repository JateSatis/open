import { useCallback, useState } from 'react';

import type { SavedMessage } from '@/api/saved';
import { showNotice } from '@/features/notifications/alertsStore';
import type { SavedActions } from '@/features/saved/useSavedActions';

/**
 * Что делают строки «Посмотреть позже»: раскрытие — независимо у каждой,
 * чекбокс — отметить или снять, свайп — убрать из вкладки с «Вернуть»
 * (прежние время и отметка).
 */
export function useWatchLaterRows({
  setWatchLater,
  restoreWatchLater,
}: Pick<SavedActions, 'setWatchLater' | 'restoreWatchLater'>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = useCallback(
    (saved: SavedMessage) =>
      setExpanded((current) => {
        const next = new Set(current);

        if (next.has(saved.id)) next.delete(saved.id);
        else next.add(saved.id);

        return next;
      }),
    [],
  );
  const toggleDone = useCallback(
    (saved: SavedMessage) => setWatchLater([saved.id], saved.watchDoneAt ? 'undone' : 'done'),
    [setWatchLater],
  );
  const remove = useCallback(
    (saved: SavedMessage) => {
      setWatchLater([saved.id], 'off');
      showNotice('Убрано из «Посмотреть позже»', 'info', {
        label: 'Вернуть',
        run: () => restoreWatchLater(saved),
      });
    },
    [restoreWatchLater, setWatchLater],
  );

  return { expanded, toggleExpanded, toggleDone, remove };
}
