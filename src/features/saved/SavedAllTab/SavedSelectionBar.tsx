import type { SavedMessage } from '@/api/saved';
import type { SelectionActionId } from '@/features/chats/messageActions';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { SAVED_SELECTION_ACTIONS } from '@/features/saved/savedActions';

export type SavedSelectionBarProps = {
  /** Выбранное — по порядку на экране. */
  selected: SavedMessage[];
  onReply: (items: SavedMessage[]) => void;
  onCopy: (items: SavedMessage[]) => void;
  /** Отвечает, открылся ли лист пересылки. */
  onForward: (items: SavedMessage[]) => Promise<boolean>;
  /** Отвечает, подтвердили ли удаление. */
  onDelete: (items: SavedMessage[]) => Promise<boolean>;
  /** Действие выполнено — выбор снимается. */
  onDone: () => void;
};

/**
 * Панель выбора «Все» — та же, что в чате: «Ответить», «Переслать»,
 * «Копировать», «Удалить». Стоит на месте поля заметок.
 */
export function SavedSelectionBar({
  selected,
  onReply,
  onCopy,
  onForward,
  onDelete,
  onDone,
}: SavedSelectionBarProps) {
  const finish = (finished: boolean) => {
    if (finished) onDone();
  };

  const run = (id: SelectionActionId) => {
    if (id === 'reply' || id === 'copy') {
      if (id === 'reply') onReply(selected);
      else onCopy(selected);
      onDone();
    }

    if (id === 'forward') void onForward(selected).then(finish);
    if (id === 'delete') void onDelete(selected).then(finish);
  };

  return (
    <SelectionActionBar context={{ selected }} actions={SAVED_SELECTION_ACTIONS} onAction={run} />
  );
}
