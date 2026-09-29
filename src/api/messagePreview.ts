// Описание сообщения одной строкой — без клиента Supabase, чтобы им могли
// пользоваться и чистые модули интерфейса.

import type { MessageKind } from '@/api/chats';

/**
 * Всё, что нужно, чтобы показать сообщение одной строкой — в цитате, в
 * плашке ответа или пересылки: без самих файлов, только их вид.
 */
export type MessagePreview = {
  kind: MessageKind;
  text: string | null;
  /** Картинка для миниатюры: фото или постер первого видео. */
  thumbnailUrl: string | null;
  /** Сколько фото и видео — «Фото» или «Альбом». */
  mediaCount: number;
  firstMediaIsVideo: boolean;
  /** Длительность голосового. */
  durationMs: number | null;
};

export type PreviewAttachment = {
  url: string;
  poster_url: string | null;
  mime_type: string | null;
  duration_ms: number | null;
  position?: number;
};

function isVisual(mimeType: string | null): boolean {
  return Boolean(mimeType?.startsWith('image/') || mimeType?.startsWith('video/'));
}

/** Описание сообщения из его вида, текста и вложений. */
export function toPreview(
  kind: MessageKind,
  text: string | null,
  attachments: PreviewAttachment[],
): MessagePreview {
  const ordered = [...attachments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const visual = ordered.filter((attachment) => isVisual(attachment.mime_type));
  const first = visual[0];
  const firstIsVideo = Boolean(first?.mime_type?.startsWith('video/'));

  return {
    kind,
    text,
    thumbnailUrl: first ? (firstIsVideo ? first.poster_url : first.url) : null,
    mediaCount: visual.length,
    firstMediaIsVideo: firstIsVideo,
    durationMs: kind === 'voice' ? (ordered[0]?.duration_ms ?? null) : null,
  };
}
