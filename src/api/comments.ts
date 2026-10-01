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

import type { RealtimeChannel } from '@supabase/supabase-js';

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
import {
  REACTION_COLUMNS,
  toAudience,
  toReactions,
  type MessageReactions,
  type MyReaction,
} from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

export const COMMENT_PAGE_SIZE = 30;

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
  /** Цитаты ответа — комментарии той же ветки, по порядку. `messageId` цитаты — id комментария. */
  replies: QuotedMessage[];
};

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
  `id, message_id, chat_id, author_id, kind, text, audience, created_at, edited_at, author:profiles(display_name, avatar_url), comment_attachments(id, url, poster_url, mime_type, width, height, duration_ms, waveform), ${REACTION_COLUMNS}, replies:comment_replies!comment_replies_comment_fkey(position, quoted_id, quoted:comments!comment_replies_quoted_fkey(id, author_id, kind, text, created_at, edited_at, author:profiles(display_name), comment_attachments(url, poster_url, mime_type, duration_ms, position)))` as const;

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
  };
}

/**
 * Страница комментариев сообщения, самые новые первыми. `cursor` — время
 * самого старого уже показанного; «загрузить все» не существует.
 */
export async function listComments(
  messageId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<Page<Comment>> {
  const limit = params.limit ?? COMMENT_PAGE_SIZE;

  let query = commentsSelect()
    .eq('message_id', messageId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.cursor) query = query.lt('created_at', params.cursor);

  const { data, error } = await query;

  if (error) throw error;

  const items = (data ?? []).map(toComment);

  return {
    items,
    nextCursor: items.length === limit ? items[items.length - 1].createdAt : null,
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

async function fetchComment(id: string): Promise<Comment> {
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
  input: { text?: string; media?: SendMessageMedia[]; replyTo?: string[] },
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_comment', {
    target_message: messageId,
    comment_text: input.text?.trim() ?? '',
    media: (input.media ?? []).map(toMediaJson),
    reply_to: input.replyTo?.length ? input.replyTo : undefined,
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
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_voice_comment', {
    target_message: messageId,
    voice: toVoiceJson(voice),
    reply_to: replyTo.length ? replyTo : undefined,
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

export type CommentChannelHandlers = {
  /** Появился комментарий. Payload — подсказка: новое клиент дочитывает из базы. */
  onAdded: (commentId: string) => void;
  onDeleted: (commentId: string) => void;
  onEdited: (commentId: string) => void;
  /** Реакции на комментарий изменились — счётчики дочитываются из базы. */
  onReactionsChanged?: (commentId: string) => void;
  /** Сообщение, к которому комментарии, правили или удалили. */
  onTargetChanged: () => void;
  /** Канал переподключился: пропущенное надо дочитать. */
  onReconnected?: () => void;
};

function commentIdOf(payload: unknown): string | null {
  const id = (payload as { comment_id?: unknown } | undefined)?.comment_id;

  return typeof id === 'string' ? id : null;
}

/**
 * Топик комментариев одного сообщения. Открыт всем аутентифицированным —
 * комментарии публичны, — события в него кладёт только база. Отдаёт отписку:
 * её обязательно звать при закрытии панели.
 */
export function subscribeToComments(
  messageId: string,
  handlers: CommentChannelHandlers,
): () => void {
  void supabase.realtime.setAuth();

  const channel: RealtimeChannel = supabase.channel(`comments:${messageId}`, {
    config: { private: true },
  });

  let joinedBefore = false;

  const on = (event: string, handler: (id: string) => void) =>
    channel.on('broadcast', { event }, ({ payload }) => {
      const id = commentIdOf(payload);

      if (id) handler(id);
    });

  on('comment_added', handlers.onAdded);
  on('comment_deleted', handlers.onDeleted);
  on('comment_edited', handlers.onEdited);
  on('comment_reactions_changed', (id) => handlers.onReactionsChanged?.(id));

  channel
    .on('broadcast', { event: 'target_changed' }, () => handlers.onTargetChanged())
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;

      if (joinedBefore) handlers.onReconnected?.();

      joinedBefore = true;
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
