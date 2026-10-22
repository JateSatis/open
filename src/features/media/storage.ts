import { File } from 'expo-file-system';

import { MEDIA_BUCKET } from './constants';
import {
  buildAvatarPath,
  buildChannelAvatarPath,
  buildGroupAvatarPath,
  CHANNEL_AVATAR_FOLDER,
  GROUP_AVATAR_FOLDER,
  buildObjectPath,
  buildPopPaths,
  ownAvatarPath,
  ownAvatarPathFromUrl,
  ownPathFromUrl,
} from './lib/objectPath';
import type { LocalMedia, UploadedMedia } from './types';

import { AVATARS_BUCKET } from '@/api/avatars';
import { supabase } from '@/api/supabase';

/**
 * The only place in the app that talks to Supabase Storage. Everything above
 * it deals in `LocalMedia` / `UploadedMedia`, so moving the bucket to a CDN
 * later is a change to this file and nothing else (CLAUDE.md, раздел 2).
 */

export class MediaUploadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

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
      poster = await uploadFile(media.posterUri, userId, 'photo', 'image/jpeg');
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
 * Видео попа с его постером — в папку попсов. Постер обязателен: без него
 * сетка канала и обложка в посте пустые, и база такой поп не примет.
 */
export async function uploadPopMedia(media: LocalMedia, userId: string): Promise<UploadedMedia> {
  if (!media.posterUri) throw new MediaUploadError('Pop has no poster');

  const paths = buildPopPaths(userId, media.mimeType);
  const main = await uploadFile(media.uri, userId, media.kind, media.mimeType, paths.video);
  let poster: StoredFile;

  try {
    poster = await uploadFile(media.posterUri, userId, 'photo', 'image/jpeg', paths.poster);
  } catch (error) {
    await removeUploadedMedia(main.path);
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

type StoredFile = { url: string; path: string; sizeBytes: number };

async function uploadFile(
  uri: string,
  userId: string,
  kind: LocalMedia['kind'],
  mimeType: string,
  at?: string,
): Promise<StoredFile> {
  const file = new File(uri);

  if (!file.exists) {
    throw new MediaUploadError(`Media file no longer exists: ${uri}`);
  }

  const sizeBytes = file.size;
  // `File` implements Blob, but Supabase Storage in React Native only handles
  // an ArrayBuffer reliably — a Blob from a file:// URI is the classic cause
  // of zero-byte objects landing in the bucket.
  const body = await file.arrayBuffer();
  const path = at ?? buildObjectPath(userId, kind, mimeType);

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw new MediaUploadError(`Failed to upload ${kind}: ${error.message}`, error);
  }

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);

  return { url: data.publicUrl, path, sizeBytes };
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
 */
export async function removeUploadedMedia(path: string | string[]): Promise<boolean> {
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .remove(Array.isArray(path) ? path : [path]);

  return !error;
}

/**
 * Загружает подготовленный аватар (`prepareAvatar`) в закрытый бакет
 * `avatars` и отдаёт путь — его и пишут в профиль. Публичной ссылки у файла
 * нет: показывают его по подписанной (`src/api/avatars.ts`) тем, кому фото
 * открыто.
 */
export async function uploadAvatar(uri: string, userId: string): Promise<string> {
  const path = buildAvatarPath(userId);
  const file = new File(uri);

  if (!file.exists) {
    throw new MediaUploadError(`Avatar file no longer exists: ${uri}`);
  }

  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });

  if (error) {
    throw new MediaUploadError(`Failed to upload avatar: ${error.message}`, error);
  }

  return path;
}

/**
 * Аватарка нового канала. Путь нужен вызывающему: канал создаётся после
 * загрузки, и если создание сорвалось, файл надо убрать (`removeUploadedMedia`).
 */
export async function uploadChannelAvatar(
  uri: string,
  userId: string,
): Promise<{ url: string; path: string }> {
  return uploadJpeg(uri, buildChannelAvatarPath(userId));
}

/**
 * Аватарка группы. Путь нужен вызывающему: если база фото не приняла (группа
 * не создалась, смена сорвалась), файл надо убрать (`removeUploadedMedia`).
 */
export async function uploadGroupAvatar(
  uri: string,
  userId: string,
): Promise<{ url: string; path: string }> {
  return uploadJpeg(uri, buildGroupAvatarPath(userId));
}

async function uploadJpeg(uri: string, path: string): Promise<{ url: string; path: string }> {
  const file = new File(uri);

  if (!file.exists) {
    throw new MediaUploadError(`Avatar file no longer exists: ${uri}`);
  }

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });

  if (error) {
    throw new MediaUploadError(`Failed to upload avatar: ${error.message}`, error);
  }

  return { url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl, path };
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

  if (legacy) await removeUploadedMedia(legacy);
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

  if (path) await removeUploadedMedia(path);
}
