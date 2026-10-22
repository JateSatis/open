/**
 * Очистка загруженного файла от метаданных и перенос на постоянное место.
 *
 * Клиент кладёт файл во временный закрытый бакет `uploads` (в свою папку) и
 * зовёт функцию с путём и видом файла. Функция:
 *   1. проверяет, что путь — в папке вызывающего (из JWT, не из тела);
 *   2. чистит файл (`_shared/mediaSanitize.ts`): JPEG — в памяти, видео и
 *      звук — потоком, без перекодирования и без загрузки mdat в память;
 *   3. пишет чистый файл на постоянный путь, который строит сама, и отмечает
 *      его в реестре `media_objects` (бакет, путь, владелец, вид — без самих
 *      метаданных);
 *   4. удаляет временный файл — и при успехе, и при отказе.
 *
 * Отправка сообщения, комментария, попа и смена фото принимают только
 * отмеченные файлы своего владельца — это проверяет база. Что не удалось
 * разобрать, не публикуется: ответ `unsupported_media`.
 *
 * Вычищенное никуда не пишется: ни в ответ, ни в реестр, ни в лог (в лог
 * уходит только имя ошибки).
 *
 * Зависимости передаются снаружи, чтобы проверить функцию Deno-тестом без
 * сети (`handler.test.ts`); настоящие — в `index.ts`.
 */

import {
  MAX_IMAGE_BYTES,
  planIsoBmff,
  planTransform,
  sanitizeJpeg,
  UnsupportedMediaError,
} from '../_shared/mediaSanitize.ts';

export const STAGING_BUCKET = 'uploads';
export const CHAT_MEDIA_BUCKET = 'chat-media';
export const MEDIA_BUCKET = 'media';
export const AVATARS_BUCKET = 'avatars';

/**
 * Видео до пяти минут после сжатия — десятки мегабайт. Предел с запасом на
 * несжатое видео старого клиента; дальше упирается в лимит Storage проекта.
 */
export const MAX_AV_BYTES = 300 * 1024 * 1024;

/** Папка рабочих копий в `uploads`: не uuid, поэтому клиенту в неё не писать. */
const WORK_FOLDER = '_work';

/** Временный файл старше этого брошен: очистка идёт секунды. */
const STALE_UPLOAD_MS = 60 * 60_000;

export type MediaKind =
  | 'photo'
  | 'poster'
  | 'video'
  | 'video_note'
  | 'voice'
  | 'avatar'
  | 'group_avatar'
  | 'channel_avatar'
  | 'pop_video'
  | 'pop_poster';

type Destination = { bucket: string; folder: string | null; format: 'jpeg' | 'bmff' };

/**
 * Куда ложится чистый файл. Медиа сообщений и комментариев — закрытый
 * `chat-media` (доступ по настройке автора), фото человека — закрытый
 * `avatars`, контент канала и группы — публичный `media`.
 */
const DESTINATIONS: Record<MediaKind, Destination> = {
  photo: { bucket: CHAT_MEDIA_BUCKET, folder: 'photo', format: 'jpeg' },
  poster: { bucket: CHAT_MEDIA_BUCKET, folder: 'poster', format: 'jpeg' },
  video: { bucket: CHAT_MEDIA_BUCKET, folder: 'video', format: 'bmff' },
  video_note: { bucket: CHAT_MEDIA_BUCKET, folder: 'video_note', format: 'bmff' },
  voice: { bucket: CHAT_MEDIA_BUCKET, folder: 'voice', format: 'bmff' },
  avatar: { bucket: AVATARS_BUCKET, folder: null, format: 'jpeg' },
  group_avatar: { bucket: MEDIA_BUCKET, folder: 'group-avatar', format: 'jpeg' },
  channel_avatar: { bucket: MEDIA_BUCKET, folder: 'channel-avatar', format: 'jpeg' },
  pop_video: { bucket: MEDIA_BUCKET, folder: 'pops', format: 'bmff' },
  pop_poster: { bucket: MEDIA_BUCKET, folder: 'pops', format: 'jpeg' },
};

const BMFF_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
};

export type SanitizeDeps = {
  /** Проверяет токен у Auth и возвращает id его владельца или null. */
  resolveUserId: (accessToken: string) => Promise<string | null>;
  /** Размер объекта; null — объекта нет. */
  size: (bucket: string, path: string) => Promise<number | null>;
  read: (bucket: string, path: string, offset: number, length: number) => Promise<Uint8Array>;
  readAll: (bucket: string, path: string) => Promise<Uint8Array>;
  stream: (bucket: string, path: string) => Promise<ReadableStream<Uint8Array>>;
  write: (
    bucket: string,
    path: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    size: number,
    contentType: string,
  ) => Promise<void>;
  register: (row: {
    bucket: string;
    path: string;
    owner_id: string;
    kind: MediaKind;
    mime_type: string;
    size_bytes: number;
  }) => Promise<void>;
  remove: (bucket: string, paths: string[]) => Promise<void>;
  /** Перенести объект внутри бакета (без копирования байтов). */
  move: (bucket: string, from: string, to: string) => Promise<void>;
  /** Временные файлы человека старше `olderThanMs` — подчистить брошенные. */
  listStale: (bucket: string, folder: string, olderThanMs: number) => Promise<string[]>;
  publicUrl: (bucket: string, path: string) => string;
  /** Имя файла на постоянном месте — случайное, не от клиента. */
  newName: () => string;
  log?: (message: string, error?: unknown) => void;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match ? match[1] : null;
}

function isKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DESTINATIONS, value);
}

/** Имя ошибки без сообщения: сообщения сторонних библиотек бывают с путями. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function createSanitizeHandler(deps: SanitizeDeps) {
  const log = deps.log ?? (() => {});

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const token = bearerToken(request);

    if (!token) return json(401, { error: 'unauthorized' });

    let userId: string | null = null;

    try {
      userId = await deps.resolveUserId(token);
    } catch (error) {
      log('resolveUserId failed', errorName(error));
    }

    if (!userId) return json(401, { error: 'unauthorized' });

    let body: { path?: unknown; kind?: unknown };

    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad_request' });
    }

    const { path, kind } = body;
    const match =
      typeof path === 'string' ? /^([0-9a-f-]{36})\/[A-Za-z0-9_-]{1,80}\.([a-z0-9]{2,4})$/.exec(path) : null;

    // Чужая папка — как отсутствующий файл: функция не подтверждает чужие пути.
    if (!match || match[1] !== userId || !isKind(kind)) return json(400, { error: 'bad_request' });

    const staged = path as string;
    const destination = DESTINATIONS[kind];
    const extension = match[2];
    // Рабочая копия — в папке, куда клиент писать не может: иначе между
    // планом очистки и потоком он подменил бы файл другим той же длины.
    const work = `${WORK_FOLDER}/${deps.newName()}.${extension}`;
    let moved = false;

    try {
      const size = await deps.size(STAGING_BUCKET, staged);

      if (size === null) return json(404, { error: 'not_found' });

      await deps.move(STAGING_BUCKET, staged, work);
      moved = true;

      let target: string;
      let contentType: string;
      let stored: number;

      if (destination.format === 'jpeg') {
        if (size > MAX_IMAGE_BYTES) return json(413, { error: 'too_large' });

        const clean = sanitizeJpeg(await deps.readAll(STAGING_BUCKET, work));

        target = targetPath(userId, destination, deps.newName(), 'jpg');
        contentType = 'image/jpeg';
        stored = clean.length;
        await deps.write(destination.bucket, target, clean, stored, contentType);
      } else {
        if (size > MAX_AV_BYTES) return json(413, { error: 'too_large' });

        const ext = kind === 'voice' ? 'm4a' : extension === 'mov' ? 'mov' : 'mp4';
        const plan = await planIsoBmff({
          size,
          read: (offset, length) => deps.read(STAGING_BUCKET, work, offset, length),
        });
        const source = await deps.stream(STAGING_BUCKET, work);

        target = targetPath(userId, destination, deps.newName(), ext);
        contentType = BMFF_EXTENSIONS[ext];
        stored = size;
        await deps.write(destination.bucket, target, source.pipeThrough(planTransform(plan)), size, contentType);
      }

      try {
        await deps.register({
          bucket: destination.bucket,
          path: target,
          owner_id: userId,
          kind,
          mime_type: contentType,
          size_bytes: stored,
        });
      } catch (error) {
        await deps.remove(destination.bucket, [target]).catch(() => undefined);
        throw error;
      }

      return json(200, {
        path: target,
        url: destination.bucket === MEDIA_BUCKET ? deps.publicUrl(destination.bucket, target) : target,
        size_bytes: stored,
        mime_type: contentType,
      });
    } catch (error) {
      if (error instanceof UnsupportedMediaError) return json(422, { error: 'unsupported_media' });

      log('sanitize failed', errorName(error));
      return json(500, { error: 'sanitize_failed' });
    } finally {
      await deps.remove(STAGING_BUCKET, [moved ? work : staged]).catch(() => undefined);
      // Брошенные загрузки (приложение закрыли до очистки) — неочищенные
      // оригиналы: при каждом вызове уходят прежние файлы этого человека.
      await deps
        .listStale(STAGING_BUCKET, userId, STALE_UPLOAD_MS)
        .then((old) => (old.length > 0 ? deps.remove(STAGING_BUCKET, old) : undefined))
        .catch(() => undefined);
    }
  };
}

function targetPath(userId: string, destination: Destination, name: string, ext: string): string {
  return destination.folder
    ? `${userId}/${destination.folder}/${name}.${ext}`
    : `${userId}/${name}.${ext}`;
}
