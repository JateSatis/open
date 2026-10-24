// Что можно сделать с сохранённым — меню и панель выбора. Своё, а не
// `MESSAGE_ACTIONS`: реакций и комментариев здесь нет, а «Посмотреть позже»,
// закреп и удаление — личные, свои. Одно место для копий и своих заметок:
// у заметки есть ещё «Изменить», у неотправленной — только «Повторить» и
// «Удалить».

import type { SavedMessage } from '@/api/saved';
import type { ContextMenuAction } from '@/features/chats/MessageContextMenu';
import type { SelectionAction } from '@/features/chats/messageActions';
import { MAX_FORWARD, MAX_QUOTES } from '@/features/chats/messageQuote';
import { isNote, isPendingNote, type SavedItem } from '@/features/saved/savedCopy';

/** Вкладка, где открыто меню: на «Посмотреть позже» — без механики «Все». */
export type SavedTab = 'all' | 'later';

export type SavedActionId =
  | 'reply'
  | 'watch_later'
  | 'watch_toggle'
  | 'copy'
  | 'edit'
  | 'select'
  | 'pin'
  | 'unpin'
  | 'forward'
  | 'retry'
  | 'delete';

function hasText(saved: SavedMessage): boolean {
  return Boolean(saved.text?.trim());
}

/**
 * Свою заметку можно исправить, как своё сообщение: текст и убрать файлы.
 * Голосовое правкой не перезаписывается — у него править нечего.
 */
export function canEditSaved(saved: SavedItem): boolean {
  return (
    isNote(saved) && !isPendingNote(saved) && (saved.kind === 'text' || saved.kind === 'media')
  );
}

/** Пункты меню записи сверху вниз. */
export function savedMenuActions(
  saved: SavedItem,
  tab: SavedTab,
): ContextMenuAction<SavedActionId>[] {
  if (isPendingNote(saved)) {
    return [
      ...(saved.status === 'failed' ? [{ id: 'retry' as const, label: 'Повторить' }] : []),
      { id: 'delete', label: 'Удалить', destructive: true },
    ];
  }

  const actions: ContextMenuAction<SavedActionId>[] = [{ id: 'reply', label: 'Ответить' }];
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
  if (canEditSaved(saved)) actions.push({ id: 'edit', label: 'Изменить' });

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
    id: 'reply',
    label: 'Ответить',
    isEnabled: ({ selected }) => selected.length > 0 && selected.length <= MAX_QUOTES,
  },
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
