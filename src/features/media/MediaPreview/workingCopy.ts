import { Skia, type SkImage } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { MediaLimits } from '@/features/media/constants';
import { resolveAssetUri } from '@/features/media/mediaLibrary';
import { perfLog } from '@/features/media/perf';

/** Рабочие копии и запечённые правки — в одной папке кеша. */
const EDITS_DIR = 'photo-edits';

/**
 * Рабочая копия фото для редактора: уже повёрнутая по EXIF и уже в
 * итоговом размере отправки (`MediaLimits.photo`). Живой показ рисует её, и
 * запекание рисует её же: отправленное совпадает с увиденным пиксель в
 * пиксель, а JPEG сжимается ровно один раз — при запекании. Поэтому сама
 * копия — PNG, без потерь.
 *
 * Skia, открыв снимок с камеры напрямую, EXIF-поворот не применяет и
 * положила бы фото на бок; `expo-image-manipulator` применяет.
 */
export type WorkingCopy = {
  uri: string;
  width: number;
  height: number;
};

const copies = new Map<string, Promise<WorkingCopy>>();
/** Готовые копии — для синхронного запекания. */
const ready = new Map<string, WorkingCopy>();
/** Раскодированные копии: декодировать PNG на каждый заход в инструмент незачем. */
const images = new Map<string, SkImage>();
/** Столько раскодированных копий держится в памяти — каждая до ~14 МБ. */
const IMAGES_KEPT = 4;

let swept = false;

function editsDir(): Directory {
  const directory = new Directory(Paths.cache, EDITS_DIR);

  // Файлы прошлого запуска никому не нужны: исходящие не переживают
  // перезапуск, а значит и повторять с ними нечего.
  if (!swept) {
    swept = true;

    try {
      if (directory.exists) directory.delete();
    } catch (error) {
      perfLog('правки: старый кеш не удалился', { error: String(error) });
    }
  }

  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

  return directory;
}

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, '_').slice(-48);
}

/** Новый файл в папке правок — каждый раз с новым именем, старые не перезаписываются. */
export function editsFile(id: string, extension: string): File {
  return new File(editsDir(), `${safeName(id)}-${Date.now()}.${extension}`);
}

async function makeWorkingCopy(id: string): Promise<WorkingCopy> {
  // content:// и ph:// открывает не каждый загрузчик — путь к файлу надёжнее.
  const source = await resolveAssetUri(id);
  const oriented = await ImageManipulator.manipulate(source).renderAsync();
  const { maxWidthPx } = MediaLimits.photo;
  const image =
    oriented.width > maxWidthPx
      ? await ImageManipulator.manipulate(oriented)
          .resize({ width: maxWidthPx, height: null })
          .renderAsync()
      : oriented;
  const saved = await image.saveAsync({ format: SaveFormat.PNG });
  const target = editsFile(id, 'png');

  // Раскодированный снимок с камеры — десятки мегабайт нативной памяти.
  image.release();
  if (image !== oriented) oriented.release();

  new File(saved.uri).move(target);

  return { uri: target.uri, width: saved.width, height: saved.height };
}

/** Рабочая копия фото — одна на файл за сеанс. */
export function workingCopyOf(id: string): Promise<WorkingCopy> {
  const known = copies.get(id);

  if (known) return known;

  const pending = makeWorkingCopy(id);

  copies.set(id, pending);
  void pending.then((copy) => ready.set(id, copy)).catch(() => undefined);
  // Не вышло — следующий заход попробует снова.
  pending.catch((error: unknown) => {
    copies.delete(id);
    perfLog('правки: рабочая копия не вышла', { id, error: String(error) });
  });

  return pending;
}

/** Готовая рабочая копия; ещё не готова — исключение. */
export function readyWorkingCopy(id: string): WorkingCopy {
  const copy = ready.get(id);

  if (!copy) throw new Error('Рабочая копия фото ещё не готова');

  return copy;
}

/** Раскодированная рабочая копия. Синхронно: запекание не ждёт. */
export function workingImageOf(id: string, copy: WorkingCopy): SkImage {
  const known = images.get(id);

  if (known) {
    // Свежий доступ — в конец очереди на вытеснение.
    images.delete(id);
    images.set(id, known);

    return known;
  }

  const data = Skia.Data.fromBytes(new File(copy.uri).bytesSync());
  const image = Skia.Image.MakeImageFromEncoded(data);

  if (!image) throw new Error('Рабочая копия фото не раскодировалась');

  images.set(id, image);

  if (images.size > IMAGES_KEPT) {
    const oldest = images.keys().next().value;

    // Не `dispose`: вытесненную копию ещё может рисовать соседняя страница.
    if (oldest !== undefined) images.delete(oldest);
  }

  return image;
}
