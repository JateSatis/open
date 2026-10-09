import { create } from 'zustand';

import { clearEditedThumbs, setEditedThumb } from './editedThumbs';
import { isEmptyEdit, normalizeEdit, type BakedPhoto, type PhotoEdit } from './types';

type PhotoEditsState = {
  /** Правки по id файла галереи. Нет записи — фото не правилось. */
  edits: Record<string, PhotoEdit>;
  /** Запечённые правки — то, что уйдёт при отправке вместо оригинала. */
  baked: Record<string, BakedPhoto>;
};

/**
 * Правки фото в предпросмотре — клиентское состояние, как и выбор файлов, и
 * живут они ровно столько же, сколько выбор: до отправки, до сброса «Отменить
 * выбор файлов?», до ухода из чата (все три чистят выбор через
 * `useMediaSelection.clear`, и он чистит правки).
 *
 * Снятие выбора с одного файла правки не трогает: вернул выбор — правки на
 * месте. Правка не выбранного сейчас файла просто ждёт в сторе.
 */
export const usePhotoEdits = create<PhotoEditsState>(() => ({ edits: {}, baked: {} }));

/**
 * Записать правку фото и её запекание. Пустая правка (все нули, обрезка
 * исходная) — то же, что её отсутствие: фото уходит оригиналом. Картинка
 * правки для плитки готовится отдельно (`setEditedThumb`); прежняя правке
 * больше не соответствует и уходит сразу.
 */
export function setPhotoEdit(id: string, input: PhotoEdit, baked: BakedPhoto | null) {
  const edit = normalizeEdit(input);

  setEditedThumb(id, null);
  usePhotoEdits.setState((state) => {
    const edits = { ...state.edits };
    const bakedById = { ...state.baked };

    if (isEmptyEdit(edit)) {
      delete edits[id];
      delete bakedById[id];
    } else {
      edits[id] = edit;

      if (baked) bakedById[id] = baked;
      else delete bakedById[id];
    }

    return { edits, baked: bakedById };
  });
}

/** Правка фото на момент вызова — для отправки и для открытия инструмента. */
export function photoEditOf(id: string): PhotoEdit | undefined {
  return usePhotoEdits.getState().edits[id];
}

export function bakedPhotoOf(id: string): BakedPhoto | undefined {
  return usePhotoEdits.getState().baked[id];
}

/** Правка одного фото — подписка для его страницы в предпросмотре. */
export function usePhotoEdit(id: string | null): PhotoEdit | undefined {
  return usePhotoEdits((state) => (id === null ? undefined : state.edits[id]));
}

/** Все правки уходят вместе с выбором. */
export function clearPhotoEdits() {
  const { edits } = usePhotoEdits.getState();

  clearEditedThumbs();
  if (Object.keys(edits).length > 0) usePhotoEdits.setState({ edits: {}, baked: {} });
}
