import { File } from 'expo-file-system';

import { MEDIA_BUCKET } from './constants';
import { buildObjectPath } from './lib/objectPath';
import type { LocalMedia, UploadedMedia } from './types';

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
  };
}

type StoredFile = { url: string; path: string; sizeBytes: number };

async function uploadFile(
  uri: string,
  userId: string,
  kind: LocalMedia['kind'],
  mimeType: string,
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
  const path = buildObjectPath(userId, kind, mimeType);

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
