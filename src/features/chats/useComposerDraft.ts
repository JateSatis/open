import { useCallback, useEffect, useState } from 'react';

import { selectedAssets, useMediaSelection, type MediaLibraryItem } from '@/features/media';

export type ComposerDraft = {
  text: string;
  setText: (text: string) => void;
  /**
   * Выбранные файлы **на момент вызова**. Функция, а не поле, намеренно: на
   * подписку сюда завязался бы весь экран чата, и один тап по кружку выбора
   * перерисовывал бы переписку целиком. Кому нужно число выбранного для
   * отрисовки — подписывается на стор сам (`useSelectionCount`).
   */
  media: () => MediaLibraryItem[];
  clear: () => void;
  /** Сбрасывает только выбор файлов — текст черновика при отмене выбора не теряется. */
  clearMedia: () => void;
};

/**
 * Черновик сообщения — текст и выбранные фото/видео — общий и для строки
 * ввода под чатом, и для такой же строки внутри шита выбора медиа: они
 * показывают один и тот же черновик, а не два независимых.
 *
 * Текст живёт здесь, выбранные файлы — в `selectionStore`: источником правды
 * для грида должен быть стор, иначе выбор файла стоит перерисовки всего
 * экрана. Черновик из него читает.
 *
 * Живёт на экране чата, а не переживает уход с него — как и раньше, когда
 * черновик был только текстом в `MessageComposer`.
 */
export function useComposerDraft(chatId: string): ComposerDraft {
  const [text, setText] = useState('');
  const clearSelection = useMediaSelection((state) => state.clear);

  // Сброс черновика при смене чата — не побочный эффект, а подстройка
  // состояния под изменившийся проп, поэтому делается прямо в рендере
  // (см. «Adjusting state when a prop changes» в документации React), а не
  // в useEffect: иначе один переход между чатами дал бы лишний рендер со
  // старым черновиком.
  const [draftChatId, setDraftChatId] = useState(chatId);

  if (draftChatId !== chatId) {
    setDraftChatId(chatId);
    setText('');
  }

  // Выбор живёт в сторе, то есть вне жизненного цикла этого экрана, и
  // очистить его надо явно — и при смене чата, и при уходе с экрана.
  useEffect(() => {
    clearSelection();

    return () => clearSelection();
  }, [chatId, clearSelection]);

  const clear = useCallback(() => {
    setText('');
    clearSelection();
  }, [clearSelection]);

  return {
    text,
    setText,
    media: selectedAssets,
    clear,
    clearMedia: clearSelection,
  };
}
