/**
 * Media produced by this feature is always destined for a row in `attachments`,
 * so the field names here mirror that table one-to-one. The INSERT itself is
 * done by the feature that sends the message — this feature only produces the
 * URL and the metadata.
 */

/** Matches the `kind` values `messages` accepts for media messages. */
export type MediaKind = 'photo' | 'video' | 'voice' | 'video_note';

/** A file that exists on the device and has not been uploaded yet. */
export type LocalMedia = {
  kind: MediaKind;
  /** `file://` URI in the app cache. */
  uri: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /**
   * Кадр видео, снятый перед отправкой (`file://` JPEG). Заливается рядом с
   * видео и показывается в плитке, пока видео не запущено. У фото — нет.
   */
  posterUri?: string | null;
};

/**
 * The result of an upload: everything `attachments` needs except `message_id`,
 * which only exists once the message itself has been inserted.
 */
export type UploadedMedia = {
  kind: MediaKind;
  /** Public URL in Supabase Storage — goes into `attachments.url`. */
  url: string;
  /** Path inside the bucket, kept so the file can be removed on a failed send. */
  path: string;
  /** Постер видео в Storage — `attachments.poster_url`. */
  posterUrl: string | null;
  posterPath: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
};
