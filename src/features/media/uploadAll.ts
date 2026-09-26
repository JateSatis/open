import { prepareForUpload } from './lib/prepareForUpload';
import { removeUploadedMedia, storedPaths, uploadMedia } from './storage';
import type { LocalMedia, UploadedMedia } from './types';

/** Столько файлов льётся в Storage одновременно — альбом до 50 штук не должен уходить одной волной. */
const UPLOAD_CONCURRENCY = 3;

/**
 * Сжимает и загружает альбом целиком, сохраняя исходный порядок. Если
 * какой-то файл не залился, уже загруженные удаляются из Storage — иначе
 * они останутся висеть в бакете без сообщения, которое на них сослалось бы
 * (сообщение с частью вложений в базу не попадёт: `send_media_message`
 * вставляет его только когда получит на руки все URL).
 */
export async function uploadAllMedia(items: LocalMedia[], userId: string): Promise<UploadedMedia[]> {
  const prepared = await Promise.all(items.map(prepareForUpload));
  const uploaded: (UploadedMedia | undefined)[] = new Array(prepared.length);
  let cursor = 0;

  async function worker() {
    while (cursor < prepared.length) {
      const index = cursor++;

      uploaded[index] = await uploadMedia(prepared[index], userId);
    }
  }

  try {
    const workerCount = Math.min(UPLOAD_CONCURRENCY, prepared.length);

    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (error) {
    await Promise.all(
      uploaded
        .filter((item): item is UploadedMedia => item !== undefined)
        .map((item) => removeUploadedMedia(storedPaths(item))),
    );

    throw error;
  }

  return uploaded as UploadedMedia[];
}
