import { useCallback, useState } from 'react';

import { MediaLimits, loadAssetUri, type LibraryAsset } from '@/features/media';

export type ComposerDraft = {
  text: string;
  setText: (text: string) => void;
  media: LibraryAsset[];
  toggleMedia: (asset: LibraryAsset) => void;
  removeMedia: (id: string) => void;
  isSelected: (id: string) => boolean;
  selectionOrder: (id: string) => number | null;
  isFull: boolean;
  clear: () => void;
  /** Сбрасывает только выбор файлов — текст черновика при отмене выбора не теряется. */
  clearMedia: () => void;
};

/**
 * Черновик сообщения — текст и выбранные фото/видео — общий и для строки
 * ввода под чатом, и для такой же строки внутри шита выбора медиа: они
 * показывают один и тот же черновик, а не два независимых.
 *
 * Живёт на экране чата, а не переживает уход с него — как и раньше, когда
 * черновик был только текстом в `MessageComposer`.
 */
export function useComposerDraft(chatId: string): ComposerDraft {
  const [text, setText] = useState('');
  const [media, setMedia] = useState<LibraryAsset[]>([]);
  // Сброс черновика при смене чата — не побочный эффект, а подстройка
  // состояния под изменившийся проп, поэтому делается прямо в рендере
  // (см. «Adjusting state when a prop changes» в документации React), а не
  // в useEffect: иначе один переход между чатами дал бы лишний рендер со
  // старым черновиком.
  const [draftChatId, setDraftChatId] = useState(chatId);

  if (draftChatId !== chatId) {
    setDraftChatId(chatId);
    setText('');
    setMedia([]);
  }

  const toggleMedia = useCallback((asset: LibraryAsset) => {
    // Грид отдаёт файл без пути, если тот ещё не прогрет, — тап по кружку
    // не ждёт файловую систему. Путь догоняет выбор здесь, задолго до
    // отправки; повторный запрос по тому же id обслуживается кэшем.
    if (asset.uri === null) {
      void loadAssetUri(asset.id)
        .then((uri) => {
          setMedia((current) =>
            current.map((item) => (item.id === asset.id ? { ...item, uri } : item)),
          );
        })
        .catch(() => {
          // Файл могли удалить из галереи — отправка попробует ещё раз и
          // честно упадёт в «не отправлено», а не подвиснет здесь.
        });
    }

    setMedia((current) => {
      const alreadySelected = current.some((item) => item.id === asset.id);

      if (alreadySelected) return current.filter((item) => item.id !== asset.id);
      if (current.length >= MediaLimits.gallery.maxSelection) return current;

      return [...current, asset];
    });
  }, []);

  const removeMedia = useCallback((id: string) => {
    setMedia((current) => current.filter((item) => item.id !== id));
  }, []);

  const isSelected = useCallback((id: string) => media.some((item) => item.id === id), [media]);

  const selectionOrder = useCallback(
    (id: string) => {
      const index = media.findIndex((item) => item.id === id);

      return index === -1 ? null : index + 1;
    },
    [media],
  );

  const clear = useCallback(() => {
    setText('');
    setMedia([]);
  }, []);

  const clearMedia = useCallback(() => {
    setMedia([]);
  }, []);

  return {
    text,
    setText,
    media,
    toggleMedia,
    removeMedia,
    isSelected,
    selectionOrder,
    isFull: media.length >= MediaLimits.gallery.maxSelection,
    clear,
    clearMedia,
  };
}
