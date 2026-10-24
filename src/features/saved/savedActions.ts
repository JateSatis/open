// Что можно сделать с сохранённым — меню и панель выбора. Своё, а не
// `MESSAGE_ACTIONS`: реакций, правки, комментариев и ответа здесь нет, а
// «Посмотреть позже», закреп и удаление — личные, свои.

import type { SavedMessage } from '@/api/saved';
import type { ContextMenuAction } from '@/features/chats/MessageContextMenu';
import type { SelectionAction } from '@/features/chats/messageActions';
import { MAX_FORWARD } from '@/features/chats/messageQuote';

/** Вкладка, где открыто меню: на «Посмотреть позже» — без механики «Все». */
export type SavedTab = 'all' | 'later';

export type SavedActionId =
  'watch_later' | 'watch_toggle' | 'copy' | 'select' | 'pin' | 'unpin' | 'forward' | 'delete';

function hasText(saved: SavedMessage): boolean {
  return Boolean(saved.text?.trim());
}

/** Пункты меню записи сверху вниз. */
export function savedMenuActions(
  saved: SavedMessage,
  tab: SavedTab,
): ContextMenuAction<SavedActionId>[] {
  const actions: ContextMenuAction<SavedActionId>[] = [];
  const all = tab === 'all';

  if (all && saved.watchLaterAt === null) {
    actions.push({ id: 'watch_later', label: 'Посмотреть позже' });
  } else if (all) {
    const done = saved.watchDoneAt !== null;

    actions.push({
      id: 'watch_toggle',
      label: done ? 'Просмотрено' : 'Не просмотрено',
      checked: done,
    });
  }

  if (hasText(saved)) actions.push({ id: 'copy', label: 'Копировать' });

  if (all) {
    actions.push({ id: 'select', label: 'Выбрать' });
    actions.push(
      saved.pinnedAt === null
        ? { id: 'pin', label: 'Закрепить' }
        : { id: 'unpin', label: 'Открепить' },
    );
  }

  actions.push({ id: 'forward', label: 'Переслать' });
  actions.push({ id: 'delete', label: 'Удалить', destructive: true });

  return actions;
}

/** Что известно о выбранном — для кнопок панели. */
export type SavedSelectionContext = { selected: SavedMessage[] };

/**
 * Кнопки панели в режиме выбора — слева направо. «Переслать» — и когда
 * часть оригиналов удалена: их пропустит пересылка, скажет уведомление.
 */
export const SAVED_SELECTION_ACTIONS: readonly SelectionAction<SavedSelectionContext>[] = [
  {
    id: 'forward',
    label: 'Переслать',
    isEnabled: ({ selected }) => selected.length > 0 && selected.length <= MAX_FORWARD,
  },
  {
    id: 'copy',
    label: 'Копировать',
    isEnabled: ({ selected }) => selected.some(hasText),
  },
  {
    id: 'delete',
    label: 'Удалить',
    destructive: true,
    isEnabled: ({ selected }) => selected.length > 0,
  },
];
