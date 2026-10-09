import { ImageFormat, Skia } from '@shopify/react-native-skia';

import { editsFile, readyWorkingCopy, workingImageOf, type WorkingCopy } from './workingCopy';

import { MediaLimits } from '@/features/media/constants';
import { perfLog } from '@/features/media/perf';
import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';
import type { BakedPhoto, PhotoEdit, PhotoFile } from '@/features/media/photoEdits/types';

/**
 * Собрать итоговую картинку из рабочей копии по правке и записать JPEG.
 * Шаги — в зафиксированном порядке (см. `PhotoEdit`): цвет, дальше обрезка и
 * рисунок, когда они появятся.
 *
 * Растровая поверхность, а не GPU: результат читается обратно в байты, и
 * считать на процессоре проще и одинаково на любом телефоне. Рабочая копия
 * уже в итоговом размере, поэтому кодирование одно — сразу в качество
 * отправки.
 */
function renderEdit(id: string, copy: WorkingCopy, edit: PhotoEdit): PhotoFile {
  const startedAt = performance.now();
  const image = workingImageOf(id, copy);
  const surface = Skia.Surface.Make(copy.width, copy.height);

  if (!surface) throw new Error('Не удалось создать поверхность для запекания');

  const paint = Skia.Paint();

  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(adjustColorMatrix(edit.adjust)));
  surface.getCanvas().drawImage(image, 0, 0, paint);
  surface.flush();

  const bytes = surface
    .makeImageSnapshot()
    .encodeToBytes(ImageFormat.JPEG, Math.round(MediaLimits.photo.quality * 100));
  const file = editsFile(id, 'jpg');

  file.write(bytes);
  perfLog('правки: запечено', { id, ms: Math.round(performance.now() - startedAt) });

  return { uri: file.uri, width: copy.width, height: copy.height };
}

/**
 * Запекание правки — лениво и один раз. Запускается в фоне после «Готово»;
 * если отправка его обогнала, допекается тут же, синхронно, — и облачко
 * всё равно сразу показывает отредактированное фото.
 */
export function bakePhoto(id: string, edit: PhotoEdit): BakedPhoto {
  let result: PhotoFile | null = null;

  return {
    file: () => {
      if (result) return result;

      try {
        result = renderEdit(id, readyWorkingCopy(id), edit);
      } catch (error) {
        // Отправка упадёт с «повторить» — оригинал вместо правки не уйдёт.
        console.warn('[photo-edit] запекание не вышло', error);
        throw error;
      }

      return result;
    },
  };
}
