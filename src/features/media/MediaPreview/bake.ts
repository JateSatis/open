import {
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
} from '@shopify/react-native-skia';
import { Image as ExpoImage } from 'expo-image';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  editsFile,
  readyWorkingCopy,
  workingCopyOf,
  workingImageOf,
  type WorkingCopy,
} from './workingCopy';

import { MediaLimits } from '@/features/media/constants';
import { perfLog } from '@/features/media/perf';
import { adjustColorMatrix } from '@/features/media/photoEdits/colorMatrix';
import {
  affineToMatrix,
  cropBounds,
  cropOutputSize,
  cropTransform,
  defaultCrop,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';
import {
  hasCrop,
  type BakedPhoto,
  type PhotoEdit,
  type PhotoFile,
} from '@/features/media/photoEdits/types';

/** Короткая сторона картинки правки для плитки: клетка сетки ~130 точек на ~3x экране. */
const THUMB_SHORT_SIDE_PX = 400;
/**
 * Больше этого исходник при запекании обрезки не раскодируется: 24 Мп —
 * ~96 МБ на время запекания. Крошечная вырезка из снимка в 50 Мп выйдет
 * чуть меньше обычного фото отправки, зато без риска нехватки памяти.
 */
const MAX_DECODE_PIXELS = 24_000_000;
/** Запас по краям вырезки — под сглаживание на границе. */
const BOUNDS_PADDING_PX = 2;

/** Обрезка правки; нет — фото целиком. */
export function cropOf(
  edit: PhotoEdit,
  copy: Pick<WorkingCopy, 'sourceWidth' | 'sourceHeight'>,
): PhotoCrop {
  return edit.crop ?? defaultCrop(copy.sourceHeight / copy.sourceWidth);
}

/**
 * Нарисовать правку на холсте `width × height`. `image` — исходник или его
 * часть: пиксель (0, 0) картинки — это точка `offset` исходника, а `pxPerUnit`
 * — сколько её пикселей в ширине исходника.
 *
 * Шаги — в зафиксированном порядке (см. `PhotoEdit`): цвет, обрезка с
 * поворотом, дальше рисунок, когда он появится. Цвет — фильтр над
 * пикселями, ему всё равно, до или после геометрии; края картинки
 * продолжаются своими пикселями (`clamp`), и сглаживание на границе
 * исходника не тянет внутрь чёрную кайму.
 */
function drawEdit(
  image: SkImage,
  edit: PhotoEdit,
  crop: PhotoCrop,
  pxPerUnit: number,
  offset: { x: number; y: number },
  width: number,
  height: number,
  mipmaps: boolean,
): Uint8Array {
  const surface = Skia.Surface.Make(width, height);

  if (!surface) throw new Error('Не удалось создать поверхность для запекания');

  const place = cropTransform(crop, { x: 0, y: 0, width, height }, pxPerUnit);
  const matrix = Skia.Matrix(affineToMatrix(place));

  matrix.translate(offset.x, offset.y);

  const shader = image.makeShaderOptions(
    TileMode.Clamp,
    TileMode.Clamp,
    FilterMode.Linear,
    mipmaps ? MipmapMode.Linear : MipmapMode.None,
    matrix,
  );
  const filter = Skia.ColorFilter.MakeMatrix(adjustColorMatrix(edit.adjust));
  const paint = Skia.Paint();

  paint.setShader(shader);
  paint.setColorFilter(filter);
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, width, height), paint);
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(
    ImageFormat.JPEG,
    Math.round(MediaLimits.photo.quality * 100),
  );

  // Растровая поверхность в итоговом размере — это ~14 МБ; ждать, пока её
  // соберёт сборщик мусора, незачем.
  snapshot.dispose();
  surface.dispose();
  paint.dispose();
  filter.dispose();
  shader.dispose();

  return bytes;
}

function writeJpeg(id: string, bytes: Uint8Array): string {
  const file = editsFile(id, 'jpg');

  file.write(bytes);

  return file.uri;
}

/**
 * Правка из рабочей копии: для облачка — сразу и синхронно, и для
 * отправки, если обрезки нет (копия уже в итоговом размере).
 */
function renderFromCopy(id: string, copy: WorkingCopy, edit: PhotoEdit): PhotoFile {
  const startedAt = performance.now();
  const crop = cropOf(edit, copy);
  const size = cropOutputSize(crop, copy.width, MediaLimits.photo.maxWidthPx);
  const bytes = drawEdit(
    workingImageOf(id, copy),
    edit,
    crop,
    copy.width,
    { x: 0, y: 0 },
    size.width,
    size.height,
    false,
  );
  const uri = writeJpeg(id, bytes);

  perfLog('правки: запечено из копии', { id, ms: Math.round(performance.now() - startedAt) });

  return { uri, ...size };
}

/**
 * Обрезка в хорошем разрешении: вырезка по ширине — как обычное фото
 * отправки, если исходник позволяет. Из рабочей копии в 1600 четверть дала
 * бы ~400 px, поэтому пиксели берутся из исходника, раскодированного сразу
 * уменьшенным ровно настолько, чтобы рамка вышла в итоговый размер; из него
 * вырезается только область под рамкой, и всё промежуточное освобождается
 * сразу.
 */
async function renderFromSource(
  id: string,
  copy: WorkingCopy,
  edit: PhotoEdit,
): Promise<PhotoFile> {
  const startedAt = performance.now();
  const crop = cropOf(edit, copy);
  const size = cropOutputSize(crop, copy.sourceWidth, MediaLimits.photo.maxWidthPx);
  const ratio = copy.sourceHeight / copy.sourceWidth;
  const budget = Math.sqrt(MAX_DECODE_PIXELS / ratio);
  const wanted = Math.min(size.width / crop.width, copy.sourceWidth, budget);

  // Рабочей копии хватает — второй раз исходник не раскодируется.
  if (wanted <= copy.width) return renderFromCopy(id, copy, edit);

  const decoded = await ExpoImage.loadAsync(copy.source, {
    maxWidth: Math.ceil(wanted),
    maxHeight: Math.ceil(wanted * ratio),
  });
  const pxPerUnit = decoded.width;
  const decodedSize = `${decoded.width}×${decoded.height}`;
  const bounds = cropBounds(crop);
  const left = Math.max(0, Math.floor(bounds.x * pxPerUnit) - BOUNDS_PADDING_PX);
  const top = Math.max(0, Math.floor(bounds.y * pxPerUnit) - BOUNDS_PADDING_PX);
  const right = Math.min(
    decoded.width,
    Math.ceil((bounds.x + bounds.width) * pxPerUnit) + BOUNDS_PADDING_PX,
  );
  const bottom = Math.min(
    decoded.height,
    Math.ceil((bounds.y + bounds.height) * pxPerUnit) + BOUNDS_PADDING_PX,
  );
  const decodedAt = performance.now();

  let piece;

  try {
    piece = await ImageManipulator.manipulate(decoded)
      .crop({ originX: left, originY: top, width: right - left, height: bottom - top })
      .renderAsync();
  } finally {
    decoded.release();
  }

  // JPEG в полном качестве, а не PNG: промежуточный файл живёт миг, а PNG
  // такого размера кодируется на телефоне в разы дольше. Потеря на нём
  // ниже того, что съест итоговое сжатие отправки.
  let saved;

  try {
    saved = await piece.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
  } finally {
    piece.release();
  }

  const pieceFile = new File(saved.uri);
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(pieceFile.bytesSync()));

  if (!image) throw new Error('Вырезка из исходника не раскодировалась');

  let uri: string;

  try {
    uri = writeJpeg(
      id,
      drawEdit(image, edit, crop, pxPerUnit, { x: left, y: top }, size.width, size.height, false),
    );
  } finally {
    image.dispose();

    try {
      pieceFile.delete();
    } catch {
      // Кеш почистится при следующем запуске.
    }
  }

  perfLog('правки: запечено из исходника', {
    id,
    исходник: `${copy.sourceWidth}×${copy.sourceHeight}`,
    раскодировано: decodedSize,
    вырезка: `${right - left}×${bottom - top}`,
    итог: `${size.width}×${size.height}`,
    раскодированиеMs: Math.round(decodedAt - startedAt),
    всегоMs: Math.round(performance.now() - startedAt),
  });

  return { uri, ...size };
}

/**
 * Картинка правки для плитки сетки и первого кадра предпросмотра —
 * маленькая, из рабочей копии, синхронно: плитка должна показать правку к
 * тому моменту, как фото в неё прилетит.
 */
export function renderEditThumb(id: string, edit: PhotoEdit): string {
  const startedAt = performance.now();
  const copy = readyWorkingCopy(id);
  const crop = cropOf(edit, copy);
  const short = Math.min(THUMB_SHORT_SIDE_PX, copy.width, copy.height);
  const landscape = crop.width >= crop.height;
  const width = Math.round(landscape ? (short * crop.width) / crop.height : short);
  const height = Math.round(landscape ? short : (short * crop.height) / crop.width);
  const uri = writeJpeg(
    id,
    drawEdit(workingImageOf(id, copy), edit, crop, copy.width, { x: 0, y: 0 }, width, height, true),
  );

  perfLog('правки: картинка для плитки', { id, ms: Math.round(performance.now() - startedAt) });

  return uri;
}

/**
 * Запекание правки — лениво и один раз.
 *
 * - `file()` — облачку, синхронно, из рабочей копии: если отправка обогнала
 *   фоновое запекание, облачко всё равно сразу показывает правку. Без
 *   обрезки это и есть итог.
 * - `prepare()` — загрузке и «повторить»: с обрезкой — из исходника в
 *   хорошем разрешении. Запускается в фоне после «Готово»; сбой забывается,
 *   и повтор отправки печёт заново.
 */
export function bakePhoto(id: string, edit: PhotoEdit): BakedPhoto {
  let preview: PhotoFile | null = null;
  let final: Promise<PhotoFile> | null = null;

  const file = () => {
    if (preview) return preview;

    try {
      preview = renderFromCopy(id, readyWorkingCopy(id), edit);
    } catch (error) {
      // Отправка упадёт с «повторить» — оригинал вместо правки не уйдёт.
      console.warn('[photo-edit] запекание не вышло', error);
      throw error;
    }

    return preview;
  };

  const prepare = () => {
    if (!final) {
      final = workingCopyOf(id).then((copy) =>
        hasCrop(edit) ? renderFromSource(id, copy, edit) : file(),
      );
      final.catch((error: unknown) => {
        console.warn('[photo-edit] запекание не вышло', error);
        final = null;
      });
    }

    return final;
  };

  return { file, prepare };
}
