import { isEmptyCrop, type PhotoCrop } from './crop';
import { normalizeDrawing, type PhotoDrawing } from './drawing';

/**
 * Правка фото — данные, а не картинка: из них картинка собирается заново и
 * для показа, и для отправки.
 *
 * Порядок сборки зафиксирован и не зависит от того, в каком порядке человек
 * трогал инструменты: цвет и размытие → обрезка и поворот → линии рисунка.
 * Цвет первым, потому что он относится к снимку, а не к рамке; размытие —
 * вместе с ним, потому что замазывает сам снимок; линии последними, потому
 * что кисть не должна перекрашиваться ползунками.
 */
export type PhotoEdit = {
  adjust: ColorAdjust;
  /** Обрезка и поворот; нет — фото целиком (см. `crop.ts`). */
  crop?: PhotoCrop;
  /** Рисунок; нет — не рисовали (см. `drawing.ts`). */
  drawing?: PhotoDrawing;
};

/**
 * Настройка цвета. Каждое значение — положение ползунка от −100 до 100,
 * ноль — без изменений. Что именно происходит с пикселями, решает одна
 * функция `adjustColorMatrix`.
 */
export type ColorAdjust = {
  exposure: number;
  contrast: number;
  saturation: number;
};

export const NEUTRAL_ADJUST: ColorAdjust = { exposure: 0, contrast: 0, saturation: 0 };

export const EMPTY_EDIT: PhotoEdit = { adjust: NEUTRAL_ADJUST };

/** Итоговый файл отредактированного фото на телефоне. */
export type PhotoFile = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Запечённая правка, как её получает отправка. Успех запоминается: обычно
 * файл уже готов — запекание стартует после «Готово».
 *
 * - `file()` — синхронно, для облачка: если отправка обогнала фоновое
 *   запекание, допекает тут же, и облачко сразу показывает правку.
 * - `prepare()` — для загрузки и «повторить»: сперва дожидается рабочей
 *   копии (её могло ещё не быть или она не удалась в прошлый раз).
 *
 * Сбой — исключение: отправка падает с «повторить», оригиналом не уходит.
 */
export type BakedPhoto = {
  file: () => PhotoFile;
  prepare: () => Promise<PhotoFile>;
};

export function isNeutralAdjust(adjust: ColorAdjust): boolean {
  'worklet';
  return adjust.exposure === 0 && adjust.contrast === 0 && adjust.saturation === 0;
}

/** Обрезка есть и не исходная. */
export function hasCrop(edit: PhotoEdit | undefined): boolean {
  return edit?.crop !== undefined && !isEmptyCrop(edit.crop);
}

/** На фото что-то нарисовано. */
export function hasDrawing(edit: PhotoEdit | undefined): boolean {
  return edit?.drawing !== undefined && edit.drawing.length > 0;
}

/** Пустая правка — правок нет. */
export function isEmptyEdit(edit: PhotoEdit): boolean {
  return isNeutralAdjust(edit.adjust) && !hasCrop(edit) && !hasDrawing(edit);
}

/** Правка без пустых частей: нетронутая обрезка и пустой рисунок — их нет. */
export function normalizeEdit(edit: PhotoEdit): PhotoEdit {
  const normalized = edit.drawing && normalizeDrawing(edit.drawing);
  const drawing = normalized && normalized.length > 0 ? normalized : undefined;
  const crop = hasCrop(edit) ? edit.crop : undefined;

  // Уже без пустых частей — та же правка: по ссылке на неё сверяется, не
  // поменяли ли её, пока она запекалась.
  if (crop === edit.crop && drawing === edit.drawing) return edit;

  return { adjust: edit.adjust, ...(crop ? { crop } : null), ...(drawing ? { drawing } : null) };
}
