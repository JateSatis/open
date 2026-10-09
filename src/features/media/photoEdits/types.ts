import { isEmptyCrop, type PhotoCrop } from './crop';

/**
 * Правка фото — данные, а не картинка: из них картинка собирается заново и
 * для показа, и для отправки.
 *
 * Порядок сборки зафиксирован и не зависит от того, в каком порядке человек
 * трогал инструменты: цвет → обрезка и поворот → рисунок и наложения. Цвет
 * первым, потому что он относится к снимку, а не к рамке; рисунок последним,
 * потому что кисть не должна перекрашиваться ползунками.
 *
 * Слои рисунка (этапы 3–4) лягут сюда же отдельными полями, а сборка —
 * отдельными шагами `renderEdit`.
 */
export type PhotoEdit = {
  adjust: ColorAdjust;
  /** Обрезка и поворот; нет — фото целиком (см. `crop.ts`). */
  crop?: PhotoCrop;
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

/** Пустая правка — правок нет. */
export function isEmptyEdit(edit: PhotoEdit): boolean {
  return isNeutralAdjust(edit.adjust) && !hasCrop(edit);
}

/** Правка без пустых частей: нетронутая обрезка — её нет. */
export function normalizeEdit(edit: PhotoEdit): PhotoEdit {
  return edit.crop === undefined || hasCrop(edit) ? edit : { adjust: edit.adjust };
}
