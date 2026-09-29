import { useCallback, useEffect, useMemo } from 'react';

import {
  clearDraft,
  setDraftMode,
  setDraftText,
  useChatDraft,
  type ComposerMode,
} from '@/features/chats/composerDraftStore';
import { selectedAssets, useMediaSelection, type MediaLibraryItem } from '@/features/media';

export type ComposerDraft = {
  text: string;
  setText: (text: string) => void;
  /** Ответ или пересылка — плашка над полем. */
  mode: ComposerMode | null;
  setMode: (mode: ComposerMode | null) => void;
  /**
   * Выбранные файлы **на момент вызова**. Функция, а не поле, намеренно: на
   * подписку сюда завязался бы весь экран чата, и один тап по кружку выбора
   * перерисовывал бы переписку целиком. Кому нужно число выбранного для
   * отрисовки — подписывается на стор сам (`useSelectionCount`).
   */
  media: () => MediaLibraryItem[];
  /** Всё отправлено: текст, плашка и файлы уходят. */
  clear: () => void;
  /** Сбрасывает только выбор файлов — текст черновика при отмене выбора не теряется. */
  clearMedia: () => void;
};

/**
 * Черновик сообщения — текст, режим (ответ, пересылка) и выбранные фото и
 * видео — общий и для строки ввода под чатом, и для такой же строки внутри
 * шита выбора медиа: они показывают один и тот же черновик, а не два
 * независимых.
 *
 * Текст и режим живут в `composerDraftStore` по чатам и переживают уход из
 * чата. Выбранные файлы — в `selectionStore`: источником правды для грида
 * должен быть стор, иначе выбор файла стоит перерисовки всего экрана. Выбор
 * с экраном и уходит.
 */
export function useComposerDraft(chatId: string): ComposerDraft {
  const { text, mode } = useChatDraft(chatId);
  const clearSelection = useMediaSelection((state) => state.clear);

  // Выбор живёт в сторе, то есть вне жизненного цикла этого экрана, и
  // очистить его надо явно — и при смене чата, и при уходе с экрана.
  useEffect(() => {
    clearSelection();

    return () => clearSelection();
  }, [chatId, clearSelection]);

  const setText = useCallback((value: string) => setDraftText(chatId, value), [chatId]);
  const setMode = useCallback(
    (value: ComposerMode | null) => setDraftMode(chatId, value),
    [chatId],
  );

  const clear = useCallback(() => {
    clearDraft(chatId);
    clearSelection();
  }, [chatId, clearSelection]);

  return useMemo(
    () => ({
      text,
      setText,
      mode,
      setMode,
      media: selectedAssets,
      clear,
      clearMedia: clearSelection,
    }),
    [clear, clearSelection, mode, setMode, setText, text],
  );
}
