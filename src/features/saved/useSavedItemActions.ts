import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage } from '@/api/saved';
import { confirm } from '@/components/ConfirmDialog/store';
import { showNotice } from '@/features/notifications/alertsStore';
import type { SavedActionId } from '@/features/saved/savedActions';
import { formatSavedForCopy } from '@/features/saved/savedCopy';
import { startSavedForward } from '@/features/saved/savedForward';
import { useSavedActions } from '@/features/saved/useSavedActions';

type Options = {
  chats: ReadonlyMap<string, ChatSummary>;
  currentUserId: string | null;
  /** «Выбрать» — только на «Все». */
  onSelect?: (saved: SavedMessage) => void;
};

/** Обработчики пунктов меню и панели выбора «Сохранённых». */
export function useSavedItemActions({ chats, currentUserId, onSelect }: Options) {
  const router = useRouter();
  const actions = useSavedActions();
  const { setWatchLater, setPinned, remove } = actions;

  const copy = useCallback(
    (items: readonly SavedMessage[]) => {
      void Clipboard.setStringAsync(formatSavedForCopy(items, chats, currentUserId)).then(() =>
        showNotice('Скопировано'),
      );
    },
    [chats, currentUserId],
  );

  /** Удаление — после подтверждения; отвечает, подтвердили ли. */
  const removeConfirmed = useCallback(
    async (ids: readonly string[]) => {
      const confirmed = await confirm({
        title:
          ids.length === 1 ? 'Удалить из сохранённых?' : `Удалить ${ids.length} из сохранённых?`,
        message: 'Если оригинал уже удалён, вернуть копию будет нельзя',
        confirmLabel: 'Удалить',
        cancelLabel: 'Отмена',
        destructive: true,
      });

      if (confirmed) remove(ids);

      return confirmed;
    },
    [remove],
  );

  const forward = useCallback(
    (items: readonly SavedMessage[]) => startSavedForward(router, items),
    [router],
  );

  const run = useCallback(
    (id: SavedActionId, saved: SavedMessage) => {
      switch (id) {
        case 'watch_later':
          setWatchLater([saved.id], 'later');
          return;
        case 'watch_toggle':
          setWatchLater([saved.id], saved.watchDoneAt ? 'undone' : 'done');
          return;
        case 'copy':
          copy([saved]);
          return;
        case 'select':
          onSelect?.(saved);
          return;
        case 'pin':
        case 'unpin':
          setPinned([saved.id], id === 'pin');
          return;
        case 'forward':
          void forward([saved]);
          return;
        case 'delete':
          void removeConfirmed([saved.id]);
          return;
      }
    },
    [copy, forward, onSelect, removeConfirmed, setPinned, setWatchLater],
  );

  return { run, copy, forward, removeConfirmed, actions };
}
