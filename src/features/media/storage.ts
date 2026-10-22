import { File } from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { MEDIA_BUCKET, STAGING_BUCKET } from './constants';
import {
  buildStagingPath,
  CHANNEL_AVATAR_FOLDER,
  GROUP_AVATAR_FOLDER,
  ownAvatarPath,
  ownAvatarPathFromUrl,
  ownPathFromUrl,
} from './lib/objectPath';
import type { LocalMedia, UploadedMedia } from './types';

import { AVATARS_BUCKET } from '@/api/avatars';
import { CHAT_MEDIA_BUCKET } from '@/api/chatMedia';
import { supabase } from '@/api/supabase';

/**
 * The only place in the app that talks to Supabase Storage. Everything above
 * it deals in `LocalMedia` / `UploadedMedia`, so moving the bucket to a CDN
 * later is a change to this file and nothing else (CLAUDE.md, раздел 2).
 *
 * Клиент сам в постоянные бакеты не пишет. Файл ложится во временный
 * закрытый `uploads`, а Edge Function `sanitize-media` вычищает из него
 * метаданные (геометку, модель телефона, даты съёмки), кладёт чистый файл на
 * постоянное место и отмечает его в реестре — база принимает в сообщения,
 * комментарии, попсы и фото только отмеченные файлы. Что функция очистить не
 * смогла, не публикуется.
 */

export class MediaUploadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    /** `unsupported` — файл не удалось очистить от метаданных, повтор не поможет. */
    readonly reason: 'failed' | 'unsupported' = 'failed',
  ) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

/** Вид файла для `sanitize-media`: от него зависят формат, бакет и папка. */
type SanitizeKind =
  | LocalMedia['kind']
  | 'poster'
  | 'avatar'
  | 'group_avatar'
  | 'channel_avatar'
  | 'pop_video'
  | 'pop_poster';

type StoredFile = {
  /** Путь на постоянном месте. */
  path: string;
  /** У публичного `media` — адрес; у закрытых бакетов — тот же путь. */
  url: string;
  sizeBytes: number;
};

type SanitizeResponse = { path: string; url: string; size_bytes: number };

/**
 * Uploads a local file and returns the metadata a row in `attachments` needs.
 * Inserting that row is the caller's job — this feature never writes to the
 * database.
 */
export async function uploadMedia(media: LocalMedia, userId: string): Promise<UploadedMedia> {
  const main = await uploadFile(media.uri, userId, media.kind, media.mimeType);
  let poster: StoredFile | null = null;

  if (media.posterUri) {
    try {
      poster = await uploadFile(media.posterUri, userId, 'poster', 'image/jpeg');
    } catch (error) {
      await removeUploadedMedia(main.path);
      throw error;
    }
  }

  return {
    kind: media.kind,
    url: main.url,
    path: main.path,
    posterUrl: poster?.url ?? null,
    posterPath: poster?.path ?? null,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    sizeBytes: main.sizeBytes,
    waveform: media.waveform ?? null,
  };
}

/**
 * Видео попа с его постером — в папку попсов публичного `media`. Постер
 * обязателен: без него сетка канала и обложка в посте пустые, и база такой
 * поп не примет.
 */
export async function uploadPopMedia(media: LocalMedia, userId: string): Promise<UploadedMedia> {
  if (!media.posterUri) throw new MediaUploadError('Pop has no poster');

  const main = await uploadFile(media.uri, userId, 'pop_video', media.mimeType);
  let poster: StoredFile;

  try {
    poster = await uploadFile(media.posterUri, userId, 'pop_poster', 'image/jpeg');
  } catch (error) {
    await removeUploadedMedia(main.path, MEDIA_BUCKET);
    throw error;
  }

  return {
    kind: media.kind,
    url: main.url,
    path: main.path,
    posterUrl: poster.url,
    posterPath: poster.path,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    sizeBytes: main.sizeBytes,
    waveform: null,
  };
}

/** Файл → временный бакет → очистка. Ответ — где лежит чистый файл. */
async function uploadFile(
  uri: string,
  userId: string,
  kind: SanitizeKind,
  mimeType: string,
): Promise<StoredFile> {
  const file = new File(uri);

  if (!file.exists) {
    throw new MediaUploadError(`Media file no longer exists: ${uri}`);
  }

  // `File` implements Blob, but Supabase Storage in React Native only handles
  // an ArrayBuffer reliably — a Blob from a file:// URI is the classic cause
  // of zero-byte objects landing in the bucket.
  const body = await file.arrayBuffer();
  const staged = buildStagingPath(userId, mimeType);

  const { error } = await supabase.storage.from(STAGING_BUCKET).upload(staged, body, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw new MediaUploadError(`Failed to upload ${kind}: ${error.message}`, error);
  }

  const { data, error: sanitizeError } = await supabase.functions.invoke<SanitizeResponse>(
    'sanitize-media',
    { body: { path: staged, kind } },
  );

  if (sanitizeError || !data) {
    // Функция убирает временный файл сама; не дошла до него — уберём здесь.
    void supabase.storage.from(STAGING_BUCKET).remove([staged]);

    const status =
      sanitizeError instanceof FunctionsHttpError
        ? (sanitizeError.context as Response | undefined)?.status
        : undefined;

    throw new MediaUploadError(
      `Failed to sanitize ${kind}`,
      sanitizeError,
      status === 422 ? 'unsupported' : 'failed',
    );
  }

  return { path: data.path, url: data.url, sizeBytes: data.size_bytes };
}

/** Всё, что загрузка положила в бакет ради одного файла: сам файл и его постер. */
export function storedPaths(media: Pick<UploadedMedia, 'path' | 'posterPath'>): string[] {
  return media.posterPath ? [media.path, media.posterPath] : [media.path];
}

/**
 * Compensates a failed send: the message row was never created, so the object
 * would otherwise sit in the bucket unreferenced. Returns whether the cleanup
 * succeeded instead of throwing — the send has already failed, and an orphaned
 * object is not the error worth showing the user on top of that.
 *
 * Медиа сообщений и комментариев — в `chat-media`; попсы, фото групп и
 * каналов — в публичном `media` (`bucket`).
 */
export async function removeUploadedMedia(
  path: string | string[],
  bucket: string = CHAT_MEDIA_BUCKET,
): Promise<boolean> {
  const { error } = await supabase.storage
    .from(bucket)
    .remove(Array.isArray(path) ? path : [path]);

  return !error;
}

/**
 * Загружает подготовленный аватар (`prepareAvatar`) и отдаёт путь в
 * закрытом бакете `avatars` — его и пишут в профиль. Публичной ссылки у
 * файла нет: показывают его по подписанной (`src/api/avatars.ts`) тем, кому
 * фото открыто.
 */
export async function uploadAvatar(uri: string, userId: string): Promise<string> {
  return (await uploadFile(uri, userId, 'avatar', 'image/jpeg')).path;
}

/**
 * Аватарка нового канала. Путь нужен вызывающему: канал создаётся после
 * загрузки, и если создание сорвалось, файл надо убрать (`removePublicMedia`).
 */
export async function uploadChannelAvatar(
  uri: string,
  userId: string,
): Promise<{ url: string; path: string }> {
  const { url, path } = await uploadFile(uri, userId, 'channel_avatar', 'image/jpeg');

  return { url, path };
}

/**
 * Аватарка группы. Путь нужен вызывающему: если база фото не приняла (группа
 * не создалась, смена сорвалась), файл надо убрать (`removePublicMedia`).
 */
export async function uploadGroupAvatar(
  uri: string,
  userId: string,
): Promise<{ url: string; path: string }> {
  const { url, path } = await uploadFile(uri, userId, 'group_avatar', 'image/jpeg');

  return { url, path };
}

/** Убрать свой файл из публичного `media`: поп, фото группы или канала. */
export function removePublicMedia(path: string | string[]): Promise<boolean> {
  return removeUploadedMedia(path, MEDIA_BUCKET);
}

/**
 * Убирает прежний аватар из бакета — он не часть переписки, хранить его
 * незачем. Аватар от провайдера или чужой файл не трогает. Сбой не ошибка:
 * новый аватар уже на месте, лишний файл лишь занимает место.
 */
export async function removeOwnAvatar(url: string | null, userId: string): Promise<void> {
  if (!url) return;

  const own = ownAvatarPath(url, userId);

  if (own) {
    await supabase.storage.from(AVATARS_BUCKET).remove([own]);
    return;
  }

  // Аватар, поставленный до переезда в закрытый бакет.
  const legacy = ownAvatarPathFromUrl(url, MEDIA_BUCKET, userId);

  if (legacy) await removePublicMedia(legacy);
}

/**
 * Убирает прежнее фото группы, если файл — мой: фото, поставленное другим
 * участником, лежит в его префиксе, и удалить его нельзя (политика бакета).
 * Сбой не ошибка — у группы уже новое фото.
 */
export async function removeOwnGroupAvatar(url: string | null, userId: string): Promise<void> {
  await removeOwnFileIn(GROUP_AVATAR_FOLDER, url, userId);
}

/** Убирает прежнее фото канала, если файл — мой. Сбой не ошибка — у канала уже новое. */
export async function removeOwnChannelAvatar(url: string | null, userId: string): Promise<void> {
  await removeOwnFileIn(CHANNEL_AVATAR_FOLDER, url, userId);
}

/** Удалить файл по адресу, только если он лежит в папке `folder` моего префикса. */
async function removeOwnFileIn(folder: string, url: string | null, userId: string): Promise<void> {
  const path = url ? ownPathFromUrl(url, MEDIA_BUCKET, userId, folder) : null;

  if (path) await removePublicMedia(path);
}
