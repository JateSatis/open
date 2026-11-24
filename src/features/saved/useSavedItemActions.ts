import { useScreenNotice } from '@/features/notifications/useScreenNotice';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from '@/navigation';
import { useCallback } from 'react';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage } from '@/api/saved';
import { confirm } from '@/components/ConfirmDialog/store';
import { discardNote } from '@/features/saved/notesOutbox';
import type { SavedActionId } from '@/features/saved/savedActions';
import { formatSavedForCopy, isNote, type SavedItem } from '@/features/saved/savedCopy';
import { startSavedForward } from '@/features/saved/savedForward';
import { useSavedActions } from '@/features/saved/useSavedActions';

type Options = {
  chats: ReadonlyMap<string, ChatSummary>;
  currentUserId: string | null;
  /** «Выбрать» — только на «Все». */
  onSelect?: (saved: SavedMessage) => void;
  /** «Ответить»: записи встают в плашку над полем «Все». */
  onReply: (items: SavedMessage[]) => void;
  /** «Изменить» своей заметки: плашка правки над полем «Все». */
  onEdit: (saved: SavedMessage) => void;
  /** «Повторить» у неотправленной заметки. */
  onRetry?: (localId: string) => void;
};

/** «Удалить заметку?», «Удалить из сохранённых?» — смотря что удаляют. */
function deleteQuestion(items: readonly SavedMessage[]) {
  const copies = items.filter((saved) => !isNote(saved)).length;

  if (copies === 0) {
    return { title: items.length === 1 ? 'Удалить заметку?' : `Удалить заметки: ${items.length}?` };
  }

  return {
    title:
      items.length === 1 ? 'Удалить из сохранённых?' : `Удалить ${items.length} из сохранённых?`,
    message: 'Если оригинал уже удалён, вернуть копию будет нельзя',
  };
}

/** Обработчики пунктов меню и панели выбора «Сохранённых». */
export function useSavedItemActions({
  chats,
  currentUserId,
  onSelect,
  onReply,
  onEdit,
  onRetry,
}: Options) {
  const notice = useScreenNotice();
  const api = useRequestClient();
  const router = useRouter();
  const actions = useSavedActions();
  const { setWatchLater, setPinned, remove } = actions;

  const copy = useCallback(
    (items: readonly SavedMessage[]) => {
      void Clipboard.setStringAsync(formatSavedForCopy(items, chats, currentUserId)).then(() =>
        notice('Скопировано'),
      );
    },
    [notice, chats, currentUserId],
  );

  /** Удаление — после подтверждения; отвечает, подтвердили ли. */
  const removeConfirmed = useCallback(
    async (items: readonly SavedMessage[]) => {
      const confirmed = await confirm({
        ...deleteQuestion(items),
        confirmLabel: 'Удалить',
        cancelLabel: 'Отмена',
        destructive: true,
      });

      if (confirmed) remove(items.map((saved) => saved.id));

      return confirmed;
    },
    [remove],
  );

  const forward = useCallback(
    (items: readonly SavedMessage[]) => startSavedForward(router, items, api),
    [api, router],
  );

  const run = useCallback(
    (id: SavedActionId, saved: SavedItem) => {
      switch (id) {
        case 'reply':
          onReply([saved]);
          return;
        case 'watch_later':
          setWatchLater([saved.id], 'later');
          return;
        case 'watch_toggle':
          setWatchLater([saved.id], saved.watchDoneAt ? 'undone' : 'done');
          return;
        case 'copy':
          copy([saved]);
          return;
        case 'edit':
          onEdit(saved);
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
        case 'retry':
          if (saved.localId) onRetry?.(saved.localId);
          return;
        case 'delete':
          // Неотправленную заметку сервер не знает — она просто уходит.
          if (saved.localId) discardNote(saved.localId, api);
          else void removeConfirmed([saved]);
          return;
      }
    },
    [api, copy, forward, onEdit, onReply, onRetry, onSelect, removeConfirmed, setPinned, setWatchLater],
  );

  return { run, copy, forward, removeConfirmed, actions };
}
