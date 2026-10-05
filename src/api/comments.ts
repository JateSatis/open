// Комментарии к сообщениям. Оставить может кто угодно — и посетитель, и
// участник, — в любом чате: участие не проверяется нигде, это правило
// продукта. Что проверяет база (миграция `20260930180000_comments.sql`):
// автора и время не подделать, чат комментария совпадает с чатом сообщения,
// к удалённому и системному сообщению комментарий не принимается, форма
// вложений та же, что у сообщений. Менять и удалять — только своё и только
// функциями.
//
// С сообщениями комментарии не смешиваются: своя таблица, свои вложения, свой
// топик Realtime (`comments:<message_id>`).
//
// Треды (миграция `20261004100000_comment_threads.sql`): верхнеуровневые
// комментарии идут по рангу, ответ ложится в тред своего корня. Тред ответа
// база выводит из его цитат — отдельного аргумента у отправки нет.

import {
  listDeletedMessageIds,
  MESSAGE_COLUMNS,
  toMessage,
  toMessageKind,
  toPreview,
  type EditMessageInput,
  type Message,
  type MessageAttachment,
  type Page,
  type QuotedMessage,
  type SendMessageMedia,
  type SendVoiceInput,
} from '@/api/chats';
import { acquireCommentTopic, type CommentTopicListener } from '@/api/commentTopics';
import {
  REACTION_COLUMNS,
  toAudience,
  toReactions,
  type MessageReactions,
  type MyReaction,
} from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

export const COMMENT_PAGE_SIZE = 30;
/** Первая порция треда и каждая следующая по «Показать ещё». */
export const THREAD_PAGE_SIZE = 10;

export type CommentKind = 'text' | 'media' | 'voice';

/** Кто оставил комментарий: участник чата или посетитель. Решает база. */
export type CommentAudience = 'member' | 'visitor';

export type Comment = {
  id: string;
  messageId: string;
  chatId: string;
  authorId: string | null;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
  audience: CommentAudience;
  kind: CommentKind;
  text: string | null;
  createdAt: string;
  editedAt: string | null;
  attachments: MessageAttachment[];
  /** Реакции по рядам и моя — как у сообщения. */
  reactions: MessageReactions;
  /** Цитаты ответа — комментарии того же треда, по порядку. `messageId` цитаты — id комментария. */
  replies: QuotedMessage[];
  /** Корень треда; `null` — комментарий сам верхнеуровневый. */
  threadRootId: string | null;
  /** Сколько живых ответов в треде. У ответов — 0. */
  repliesCount: number;
  /** Ранг верха на момент выборки: по нему идёт следующая страница. */
  rank: number;
  /**
   * Удалённый корень, у которого остались ответы: тред живёт, а на месте
   * корня — заглушка. Содержимого база не отдаёт.
   */
  deleted: boolean;
};

/** Где кончилась страница верха: keyset по рангу. */
export type RootCursor = { rank: number; id: string };

/** Сообщение, к которому открыты комментарии, — каким оно сейчас. */
export type CommentTarget =
  | {
      state: 'live';
      message: Message;
      /** `null` — аккаунт автора удалён. */
      authorName: string | null;
      authorAvatarUrl: string | null;
    }
  | { state: 'deleted' }
  | { state: 'missing' };

const COMMENT_COLUMNS =
  `id, message_id, chat_id, author_id, kind, text, audience, created_at, edited_at, deleted_at, thread_root_id, replies_count, rank, author:profiles(display_name, avatar_url), comment_attachments(id, url, poster_url, mime_type, width, height, duration_ms, waveform), ${REACTION_COLUMNS}, replies:comment_replies!comment_replies_comment_fkey(position, quoted_id, quoted:comments!comment_replies_quoted_fkey(id, author_id, kind, text, created_at, edited_at, author:profiles(display_name), comment_attachments(url, poster_url, mime_type, duration_ms, position)))` as const;

// Мозаика собирается в порядке выбора файлов, а PostgREST не гарантирует
// порядок вложенной выборки без явного order.
const commentsSelect = () =>
  supabase
    .from('comments')
    .select(COMMENT_COLUMNS)
    .order('position', { referencedTable: 'comment_attachments' });

const targetSelect = () =>
  supabase
    .from('messages')
    .select(`${MESSAGE_COLUMNS}, author:profiles!messages_author_id_fkey(display_name, avatar_url)`)
    .order('position', { referencedTable: 'attachments' });

/**
 * Верх по рангу — функцией `list_thread_roots`: она же отдаёт заглушки
 * удалённых корней с живыми ответами. Строки — те же, что у выборки из
 * таблицы, поэтому и разбор один.
 */
const rootsSelect = (messageId: string, cursor: RootCursor | undefined, limit: number) =>
  supabase
    .rpc('list_thread_roots', {
      target_message: messageId,
      after_rank: cursor?.rank,
      after_id: cursor?.id,
      page_size: limit,
    })
    .select(COMMENT_COLUMNS)
    .order('rank', { ascending: false })
    .order('id', { ascending: false })
    .order('position', { referencedTable: 'comment_attachments' });

type CommentRow = NonNullable<Awaited<ReturnType<typeof commentsSelect>>['data']>[number];
type CommentReplyRow = NonNullable<CommentRow['replies']>[number];

/** Цитата — живой комментарий ветки или «удалён»: удалённого SELECT-политика не отдаёт. */
function toQuotedComment(row: CommentReplyRow): QuotedMessage {
  const quoted = row.quoted;

  if (!quoted) return { messageId: row.quoted_id, state: 'deleted' };

  const attachments = [...(quoted.comment_attachments ?? [])].sort(
    (a, b) => a.position - b.position,
  );

  return {
    messageId: quoted.id,
    state: 'live',
    authorId: quoted.author_id,
    authorName: quoted.author_id ? (quoted.author?.display_name ?? 'Без имени') : null,
    createdAt: quoted.created_at,
    editedAt: quoted.edited_at,
    preview: toPreview(toMessageKind(quoted.kind), quoted.text, attachments),
  };
}

function toKind(kind: string): CommentKind {
  return kind === 'media' || kind === 'voice' ? kind : 'text';
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    messageId: row.message_id,
    chatId: row.chat_id,
    authorId: row.author_id,
    // Аккаунт удалён — ссылка обнулилась; скрытый профиль база тоже не отдаёт.
    authorName: row.author_id && row.author ? (row.author.display_name ?? 'Без имени') : null,
    authorAvatarUrl: row.author?.avatar_url ?? null,
    audience: row.audience === 'member' ? 'member' : 'visitor',
    kind: toKind(row.kind),
    text: row.text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    attachments: (row.comment_attachments ?? []).map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      posterUrl: attachment.poster_url,
      mimeType: attachment.mime_type,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.duration_ms,
      waveform: attachment.waveform,
    })),
    reactions: toReactions(row),
    replies: [...(row.replies ?? [])].sort((a, b) => a.position - b.position).map(toQuotedComment),
    threadRootId: row.thread_root_id,
    repliesCount: row.replies_count,
    rank: row.rank ?? 0,
    deleted: row.deleted_at !== null,
  };
}

/**
 * Страница верхнеуровневых комментариев по рангу — сверху популярные.
 * `cursor` — ранг и id последнего показанного; «загрузить все» не существует.
 * Ранг между страницами может вырасти — повторы отсекает клиент.
 */
export async function listThreadRoots(
  messageId: string,
  params: { cursor?: RootCursor; limit?: number } = {},
): Promise<{ items: Comment[]; nextCursor: RootCursor | null }> {
  const limit = params.limit ?? COMMENT_PAGE_SIZE;
  // Лишняя строка — признак, что дальше ещё есть (как у ответов треда).
  const { data, error } = await rootsSelect(messageId, params.cursor, limit + 1);

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.slice(0, limit).map(toComment);
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: rows.length > limit && last ? { rank: last.rank, id: last.id } : null,
  };
}

/**
 * Ответы треда по порядку — сверху первые. `cursor` — время последнего уже
 * загруженного ответа: два ответа одного треда за одну транзакцию не
 * появляются, поэтому времени хватает.
 */
export async function listThreadReplies(
  rootId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<Page<Comment>> {
  const limit = params.limit ?? THREAD_PAGE_SIZE;

  // На одну строку больше страницы: пришла лишняя — ответы ещё остались.
  // По `length === limit` тред ровно из 10 ответов показывал пустую кнопку
  // «Показать ещё».
  let query = commentsSelect()
    .eq('thread_root_id', rootId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit + 1);

  if (params.cursor) query = query.gt('created_at', params.cursor);

  const { data, error } = await query;

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.slice(0, limit).map(toComment);

  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].createdAt : null,
  };
}

/** Пришедшие после `since`, от старых к новым, — дочитывание по сигналу. */
export async function listCommentsSince(messageId: string, since: string): Promise<Comment[]> {
  const { data, error } = await commentsSelect()
    .eq('message_id', messageId)
    .is('deleted_at', null)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(COMMENT_PAGE_SIZE);

  if (error) throw error;

  return (data ?? []).map(toComment);
}

/**
 * Комментарии по id — живые. Удалённых база не отдаёт, поэтому отсутствие
 * в ответе и есть ответ «удалён»: так одним запросом сверяются и правки, и
 * удаления.
 */
export async function listCommentsByIds(ids: string[]): Promise<Comment[]> {
  if (ids.length === 0) return [];

  const { data, error } = await commentsSelect().in('id', ids).is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map(toComment);
}

export async function fetchComment(id: string): Promise<Comment> {
  const { data, error } = await commentsSelect().eq('id', id).single();

  if (error) throw error;

  return toComment(data);
}

function toMediaJson(item: SendMessageMedia) {
  return {
    url: item.url,
    poster_url: item.posterUrl,
    mime_type: item.mimeType,
    width: item.width,
    height: item.height,
    duration_ms: item.durationMs,
    size_bytes: item.sizeBytes,
  };
}

function toVoiceJson(voice: SendVoiceInput) {
  return {
    url: voice.url,
    mime_type: voice.mimeType,
    duration_ms: Math.round(voice.durationMs),
    size_bytes: voice.sizeBytes,
    waveform: voice.waveform,
  };
}

/** Текст или альбом с подписью — одной транзакцией, функцией `send_comment`. */
export async function sendComment(
  messageId: string,
  input: {
    text?: string;
    media?: SendMessageMedia[];
    replyTo?: string[];
    /** Тред ответа; без него — тред по цитатам или верхнеуровневый. */
    threadRootId?: string | null;
  },
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_comment', {
    target_message: messageId,
    comment_text: input.text?.trim() ?? '',
    media: (input.media ?? []).map(toMediaJson),
    reply_to: input.replyTo?.length ? input.replyTo : undefined,
    thread_root: input.threadRootId ?? undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('Не удалось отправить комментарий');

  return fetchComment(id);
}

/** Голосовое — функцией `send_voice_comment`: один файл-звук с длительностью. */
export async function sendVoiceComment(
  messageId: string,
  voice: SendVoiceInput,
  replyTo: string[] = [],
  threadRootId: string | null = null,
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_voice_comment', {
    target_message: messageId,
    voice: toVoiceJson(voice),
    reply_to: replyTo.length ? replyTo : undefined,
    thread_root: threadRootId ?? undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('Не удалось отправить голосовое');

  return fetchComment(id);
}

/**
 * Правит свой комментарий — `edit_comment`, одной транзакцией. Прежнюю
 * версию база сохраняет для модерации. Отдаёт комментарий, каким он стал.
 */
export async function editComment(commentId: string, input: EditMessageInput): Promise<Comment> {
  const { error } = await supabase.rpc('edit_comment', {
    target_comment: commentId,
    comment_text: input.text.trim(),
    media: input.media.map((item) =>
      'attachmentId' in item ? { attachment_id: item.attachmentId } : toMediaJson(item),
    ),
    voice: input.voice
      ? 'attachmentId' in input.voice
        ? { attachment_id: input.voice.attachmentId }
        : toVoiceJson(input.voice)
      : undefined,
  });

  if (error) throw error;

  return fetchComment(commentId);
}

/**
 * Моя реакция на комментарий: ставит, меняет или снимает (`null`). Ряд —
 * участник или посетитель — решает база по участию в чате комментария.
 */
export async function setCommentReaction(
  commentId: string,
  emoji: string | null,
): Promise<MyReaction | null> {
  const { data, error } = await supabase.rpc('set_reaction', {
    target_type: 'comment',
    target_id: commentId,
    // Снятие — NULL, а генератор типов не размечает скалярные аргументы rpc как nullable.
    reaction: emoji as string,
  });

  if (error) throw error;

  const row = data?.[0];

  return row ? { emoji: row.emoji, audience: toAudience(row.audience) } : null;
}

/** Свежие реакции этих комментариев — пачкой, по сигналу канала. Удалённых база не отдаёт. */
export async function listCommentReactions(
  commentIds: string[],
): Promise<{ id: string; reactions: MessageReactions }[]> {
  if (commentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('comments')
    .select(`id, ${REACTION_COLUMNS}` as const)
    .in('id', commentIds.slice(0, 500))
    .is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map((row) => ({ id: row.id, reactions: toReactions(row) }));
}

/** Удаляет свой комментарий для всех — мягко. Повтор не ошибка. */
export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_comment', { target_comment: commentId });

  if (error) throw error;
}

/**
 * Сообщение, к которому открыты комментарии. Удалённое обычная выборка не
 * отдаёт — тогда спрашиваем, удалено ли оно, чтобы честно сказать
 * «Сообщение удалено», а не «не найдено».
 */
export async function getCommentTarget(messageId: string): Promise<CommentTarget> {
  const { data, error } = await targetSelect()
    .eq('id', messageId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return {
      state: 'live',
      message: toMessage(data),
      authorName: data.author_id && data.author ? (data.author.display_name ?? 'Без имени') : null,
      authorAvatarUrl: data.author?.avatar_url ?? null,
    };
  }

  const deleted = await listDeletedMessageIds([messageId]);

  return deleted.includes(messageId) ? { state: 'deleted' } : { state: 'missing' };
}

// =============================================================================
// Realtime
// =============================================================================

export type { CommentTopicListener as CommentChannelHandlers } from '@/api/commentTopics';

/**
 * Топик комментариев одного сообщения. Открыт всем аутентифицированным —
 * комментарии публичны, — события в него кладёт только база. Канал общий
 * (`commentTopics`): его слушают и панель, и чаты с пересланными из этой
 * ветки комментариями. Отдаёт отписку: её обязательно звать в cleanup.
 */
export function subscribeToComments(messageId: string, handlers: CommentTopicListener): () => void {
  return acquireCommentTopic(messageId, handlers);
}
