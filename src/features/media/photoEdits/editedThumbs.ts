import { useCallback, useSyncExternalStore } from 'react';

/**
 * Уменьшенные картинки отредактированных фото — для плитки сетки и первого
 * кадра предпросмотра. Плитка и перелёт показывают одну и ту же картинку.
 *
 * Не zustand, а таблица с подписками по id: клетка сетки держит одну
 * подписку на выбор (`useSelectionSlot`), и любая подписка на общий стор
 * пересчитывалась бы в каждой клетке окна на каждый тап по кружку. Здесь
 * слушатель клетки вызывается, только когда меняется картинка её файла.
 */
const thumbs = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function notify(id: string) {
  listeners.get(id)?.forEach((listener) => listener());
}

export function setEditedThumb(id: string, uri: string | null) {
  if ((thumbs.get(id) ?? null) === uri) return;

  if (uri === null) thumbs.delete(id);
  else thumbs.set(id, uri);

  notify(id);
}

export function editedThumbOf(id: string): string | undefined {
  return thumbs.get(id);
}

export function clearEditedThumbs() {
  const ids = [...thumbs.keys()];

  thumbs.clear();
  ids.forEach(notify);
}

function subscribe(id: string, listener: () => void): () => void {
  let set = listeners.get(id);

  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }

  set.add(listener);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

/** Картинка правки файла; нет — файл не правился или она ещё не готова. */
export function useEditedThumb(id: string): string | undefined {
  const onChange = useCallback((listener: () => void) => subscribe(id, listener), [id]);

  return useSyncExternalStore(onChange, () => thumbs.get(id));
}
