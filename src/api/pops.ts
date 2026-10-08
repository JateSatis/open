// Попсы канала: вертикальные видео, отдельная от сообщений сущность. Читает
// их любой; публикуют только функции в базе — `publish_pop` (поп и, по флагу,
// пост с ним одной транзакцией) и `send_pop_post` (пост с уже опубликованным
// попом). Право публиковать проверяет база, а не клиент.

import { supabase } from '@/api/supabase';
import type { Tables } from '@/api/types.gen';

export const POPS_PAGE_SIZE = 30;

type PopRow = Pick<
  Tables<'pops'>,
  | 'id'
  | 'channel_id'
  | 'author_id'
  | 'caption'
  | 'url'
  | 'poster_url'
  | 'mime_type'
  | 'width'
  | 'height'
  | 'duration_ms'
  | 'created_at'
>;

export type Pop = {
  id: string;
  channelId: string;
  /** `null` — аккаунт автора удалён. */
  authorId: string | null;
  caption: string | null;
  url: string;
  posterUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  createdAt: string;
};

/** Загруженный файл попа — то, что `publish_pop` кладёт в строку попа. */
export type PopMedia = {
  url: string;
  posterUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  sizeBytes: number;
};

export type PublishPopInput = {
  channelId: string;
  /** Выбирает клиент: повтор после обрыва отдаёт уже созданный поп, а не второй. */
  popId: string;
  media: PopMedia;
  caption: string | null;
  /** Заодно опубликовать пост с этим попом. */
  alsoPost: boolean;
  postText: string | null;
  replyTo?: string[];
};

const COLUMNS =
  'id, channel_id, author_id, caption, url, poster_url, mime_type, width, height, duration_ms, created_at';

function toPop(row: PopRow): Pop {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    caption: row.caption,
    url: row.url,
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

/** Страница попсов канала, новые сначала; `before` — последний поп прошлой страницы. */
export async function listPops(
  channelId: string,
  before: Pick<Pop, 'id' | 'createdAt'> | null = null,
  limit = POPS_PAGE_SIZE,
): Promise<Pop[]> {
  let query = supabase
    .from('pops')
    .select(COLUMNS)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  // Попсы одной секунды не теряются между страницами: курсор — пара время + id.
  if (before) {
    // Время в кавычках: в нём `+` и `:`, которые фильтр иначе разберёт по-своему.
    const at = `"${before.createdAt}"`;

    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map(toPop);
}

/** Могу ли я публиковать в канале — посты и попсы. Решает база. */
export async function canPublishInChannel(channelId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_publish_in_channel', {
    target_channel: channelId,
  });

  if (error) throw error;

  return data === true;
}

/** Публикует поп и, если просили, пост с ним. Отдаёт id попа и поста. */
export async function publishPop(
  input: PublishPopInput,
  signal?: AbortSignal,
): Promise<{ popId: string; messageId: string | null }> {
  let request = supabase.rpc('publish_pop', {
    target_channel: input.channelId,
    new_pop: input.popId,
    media: {
      url: input.media.url,
      poster_url: input.media.posterUrl,
      mime_type: input.media.mimeType,
      width: input.media.width,
      height: input.media.height,
      duration_ms: Math.round(input.media.durationMs),
      size_bytes: input.media.sizeBytes,
    },
    caption: input.caption ?? undefined,
    also_post: input.alsoPost,
    post_text: input.postText ?? undefined,
    reply_to: input.replyTo && input.replyTo.length > 0 ? input.replyTo : undefined,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  const row = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (typeof row.pop_id !== 'string') throw new Error('Не удалось опубликовать поп');

  return {
    popId: row.pop_id,
    messageId: typeof row.message_id === 'string' ? row.message_id : null,
  };
}
