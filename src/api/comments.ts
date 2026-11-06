// Комментарии к сообщениям и к попсам. Оставить может кто угодно — и посетитель, и
// участник, — в любом чате: участие не проверяется нигде, это правило
// продукта. Что проверяет база (миграция `20260930180000_comments.sql`):
// автора и время не подделать, чат комментария совпадает с чатом сообщения,
// к удалённому и системному сообщению комментарий не принимается, форма
// вложений та же, что у сообщений. Менять и удалять — только своё и только
// функциями.
//
// С сообщениями комментарии не смешиваются: своя таблица, свои вложения, свой
// топик Realtime (`comments:<target_id>`).
//
// Цель комментария — сообщение или поп (миграция `20261011100000_pop_comments.sql`).
// Id цели у них из одного пространства uuid, поэтому кеш, топик и выборки
// ключуются голым id цели; тип нужен только отправке и шапке панели.
//
// Треды комментариев (миграция `20261004100000_comment_threads.sql`): верхнеуровневые
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
  type QuotedMessage,
  type SendMessageMedia,
  type SendVoiceInput,
} from '@/api/chats';
import { acquireCommentTopic, type CommentTopicListener } from '@/api/commentTopics';
import { attachmentFromRow } from '@/api/messageRows';
import {
  REACTION_COLUMNS,
  toAudience,
  toReactions,
  type MessageReactions,
  type MyReaction,
} from '@/api/reactionCounts';
import { FRAGMENT_QUOTE_COLUMNS, toFragmentQuote, type FragmentQuote } from '@/api/fragmentQuote';
import { opaqueFlag } from '@/api/opaquePeople';
import { supabase } from '@/api/supabase';

export type { FragmentQuote } from '@/api/fragmentQuote';

export const COMMENT_PAGE_SIZE = 30;
/** Первая порция треда и каждая следующая по «Показать ещё». */
export const COMMENT_THREAD_PAGE_SIZE = 10;

export type CommentKind = 'text' | 'media' | 'voice';

/** К чему комментарии: сообщение или поп. */
export type CommentSubject = { type: 'message' | 'pop'; id: string };

/** Кто оставил комментарий: участник чата или посетитель. Решает база. */
export type CommentAudience = 'member' | 'visitor';

export type Comment = {
  id: string;
  /** Сообщение или поп, к которому комментарий. */
  targetId: string;
  /** Чат сообщения; у комментария к попу — чат постов канала. */
  chatId: string;
  authorId: string | null;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
  /**
   * Автор подменён в диалоге сообщения: `authorId` — непрозрачный id чата,
   * профиля за ним нет.
   */
  authorOpaque?: boolean;
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
  commentThreadRootId: string | null;
  /** Фрагмент текста сообщения, к которому комментарий (только у верхнеуровневого). */
  fragmentId: string | null;
  /**
   * Цитата фрагмента и где он сейчас в тексте. `null` при `fragmentId` —
   * фрагмент не читается: его сообщение удалено.
   */
  fragmentQuote: FragmentQuote | null;
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

export const commentFocusQueryKey = (commentId: string) => ['comment-focus', commentId] as const;

/** Где кончилась страница верха: keyset по рангу. */
export type RootCursor = { rank: number; id: string };

/** Устойчивый порядок ответов даже когда несколько созданы в одной транзакции. */
export type CommentThreadCursor = { createdAt: string; id: string };

/** Поп, к которому открыты комментарии, — то, что нужно панели. */
export type CommentPop = {
  id: string;
  channelId: string;
  /** Название канала — подпись в предпросмотре файлов. */
  channelTitle: string;
  /** Чат постов канала — чат комментариев попа. */
  postsChatId: string;
  commentsCount: number;
  /** Обложка и подпись — для цитаты, если комментарий перешлют. */
  posterUrl: string;
  caption: string | null;
};

/** Сообщение или поп, к которому открыты комментарии, — каким оно сейчас. */
export type CommentTarget =
  | {
      state: 'live';
      message: Message;
      /** `null` — аккаунт автора удалён. */
      authorName: string | null;
      authorAvatarUrl: string | null;
    }
  | { state: 'pop'; pop: CommentPop }
  | { state: 'deleted' }
  | { state: 'missing' };

// Комментарии — из `comment_rows`: автор глазами смотрящего (имя, фото,
// непрозрачный id считает база), профили клиенту не читаются.
const COMMENT_COLUMNS =
  `id, target_id, chat_id, author_id, author_name, author_avatar_url, author_opaque, kind, text, audience, created_at, edited_at, deleted_at, thread_root_id, fragment_id, replies_count, rank, ${FRAGMENT_QUOTE_COLUMNS}, comment_attachments:comment_attachment_rows(id, url, poster_url, mime_type, width, height, duration_ms, waveform, media_hidden), ${REACTION_COLUMNS}, replies:comment_replies!comment_replies_comment_fkey(position, quoted_id, quoted:comment_rows!comment_replies_quoted_fkey(id, author_id, author_name, author_opaque, kind, text, created_at, edited_at, comment_attachments:comment_attachment_rows(url, poster_url, mime_type, duration_ms, position)))` as const;

// Мозаика собирается в порядке выбора файлов, а PostgREST не гарантирует
// порядок вложенной выборки без явного order.
const commentsSelect = () =>
  supabase
    .from('comment_rows')
    .select(COMMENT_COLUMNS)
    .order('position', { referencedTable: 'comment_attachments' });

// Автор (имя и аватарка) — колонки `MESSAGE_COLUMNS`, глазами смотрящего.
const targetSelect = () =>
  supabase
    .from('message_rows')
    .select(MESSAGE_COLUMNS)
    .order('position', { referencedTable: 'attachments' });

/**
 * Набор фрагментов текста сообщения, чьи комментарии показывает боковая
 * панель: кластер или выделенная область (code points, «больше половины
 * фрагмента внутри» решает база).
 */
export type FragmentSet =
  | { kind: 'cluster'; clusterId: string }
  | { kind: 'area'; start: number; end: number };

function setArgs(set: FragmentSet | undefined) {
  if (set?.kind === 'cluster') return { cluster: set.clusterId };
  if (set?.kind === 'area') return { area_start: set.start, area_end: set.end };

  return {};
}

/**
 * Верх по рангу — функцией `list_comment_thread_roots`: она же отдаёт заглушки
 * удалённых корней с живыми ответами. Строки — те же, что у выборки из
 * таблицы, поэтому и разбор один.
 */
const rootsSelect = (
  targetId: string,
  cursor: RootCursor | undefined,
  limit: number,
  set: FragmentSet | undefined,
) =>
  supabase
    .rpc('list_comment_thread_roots', {
      target: targetId,
      after_rank: cursor?.rank,
      after_id: cursor?.id,
      page_size: limit,
      ...setArgs(set),
    })
    .select(COMMENT_COLUMNS)
    .order('rank', { ascending: false })
    .order('id', { ascending: false })
    .order('position', { referencedTable: 'comment_attachments' });

/** Закреплённый комментарий цели — функцией `pinned_comment`, те же колонки. */
const pinnedSelect = (targetId: string, set: FragmentSet | undefined) =>
  supabase
    .rpc('pinned_comment', { target: targetId, ...setArgs(set) })
    .select(COMMENT_COLUMNS)
    .order('position', { referencedTable: 'comment_attachments' });

type CommentRow = NonNullable<Awaited<ReturnType<typeof commentsSelect>>['data']>[number];
type CommentReplyRow = NonNullable<CommentRow['replies']>[number];

/** Цитата — живой комментарий ветки или «удалён»: удалённого SELECT-политика не отдаёт. */
function toQuotedComment(row: CommentReplyRow): QuotedMessage {
  const quoted = row.quoted;

  if (!quoted) return { messageId: row.quoted_id, state: 'deleted' };

  const attachments = [...(quoted.comment_attachments ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  return {
    messageId: quoted.id,
    state: 'live',
    authorId: quoted.author_id,
    authorName: quoted.author_id ? (quoted.author_name ?? 'Без имени') : null,
    authorOpaque: opaqueFlag(quoted.author_id, quoted.author_opaque),
    // Цитата комментария — не сообщение переписки: номера у неё нет, к ней
    // переходят по id в ветке. Время комментариев на этом этапе не скрыто,
    // и номер правки — время правки.
    seq: 0,
    createdAt: quoted.created_at,
    editMark: quoted.edited_at ? Date.parse(quoted.edited_at) : null,
    preview: toPreview(toMessageKind(quoted.kind), quoted.text, attachments),
  };
}

function toKind(kind: string): CommentKind {
  return kind === 'media' || kind === 'voice' ? kind : 'text';
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    // Вычисляемая колонка: генератор типов пишет её nullable, а база держит
    // ровно одну цель у каждого комментария.
    targetId: row.target_id ?? '',
    chatId: row.chat_id,
    authorId: row.author_id,
    // Аккаунт удалён — ссылка обнулилась, имени нет.
    authorName: row.author_id ? (row.author_name ?? 'Без имени') : null,
    authorAvatarUrl: row.author_avatar_url,
    authorOpaque: opaqueFlag(row.author_id, row.author_opaque),
    audience: row.audience === 'member' ? 'member' : 'visitor',
    kind: toKind(row.kind),
    text: row.text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    attachments: (row.comment_attachments ?? []).map(attachmentFromRow),
    reactions: toReactions(row),
    replies: [...(row.replies ?? [])].sort((a, b) => a.position - b.position).map(toQuotedComment),
    commentThreadRootId: row.thread_root_id,
    fragmentId: row.fragment_id,
    fragmentQuote: toFragmentQuote(row.fragment_id, row.fragment),
    repliesCount: row.replies_count,
    rank: row.rank ?? 0,
    deleted: row.deleted_at !== null,
  };
}

/**
 * Страница верхнеуровневых комментариев по рангу — сверху популярные.
 * `cursor` — ранг и id последнего показанного; «загрузить все» не существует.
 * Ранг между страницами может вырасти — повторы отсекает клиент.
 * `set` — только корни фрагментов набора (боковая панель).
 */
export async function listCommentThreadRoots(
  targetId: string,
  params: { cursor?: RootCursor; limit?: number; set?: FragmentSet } = {},
): Promise<{ items: Comment[]; nextCursor: RootCursor | null }> {
  const limit = params.limit ?? COMMENT_PAGE_SIZE;
  // Лишняя строка — признак, что дальше ещё есть (как у ответов треда).
  const { data, error } = await rootsSelect(targetId, params.cursor, limit + 1, params.set);

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
 * Закреплённый автором контента комментарий цели или `null`. Страницы ранга
 * его не содержат — он идёт первым отдельно. С набором — только если он
 * комментарий фрагмента набора.
 */
export async function getPinnedComment(
  targetId: string,
  set?: FragmentSet,
): Promise<Comment | null> {
  const { data, error } = await pinnedSelect(targetId, set);

  if (error) throw error;

  const [row] = data ?? [];

  return row ? toComment(row) : null;
}

/**
 * Закрепляет верхнеуровневый комментарий у его цели; прежний закреп снимается.
 * Право — у автора контента, его проверяет база (`pin_comment`).
 */
export async function pinComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('pin_comment', { target_comment: commentId });

  if (error) throw error;
}

/** Снимает закреп у цели — сообщения или попа. */
export async function unpinComment(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('unpin_comment', { target: targetId });

  if (error) throw error;
}

/**
 * Ответы треда по порядку — сверху первые. `cursor` — время последнего уже
 * загруженного ответа: два ответа одного треда за одну транзакцию не
 * появляются, поэтому времени хватает.
 */
export async function listCommentThreadReplies(
  rootId: string,
  params: { cursor?: string | CommentThreadCursor; limit?: number } = {},
): Promise<{ items: Comment[]; nextCursor: CommentThreadCursor | null }> {
  const limit = params.limit ?? COMMENT_THREAD_PAGE_SIZE;

  // На одну строку больше страницы: пришла лишняя — ответы ещё остались.
  // По `length === limit` тред ровно из 10 ответов показывал пустую кнопку
  // «Показать ещё».
  let query = commentsSelect()
    .eq('thread_root_id', rootId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (typeof params.cursor === 'string') {
    query = query.gt('created_at', params.cursor);
  } else if (params.cursor) {
    query = query.or(
      `created_at.gt.${params.cursor.createdAt},and(created_at.eq.${params.cursor.createdAt},id.gt.${params.cursor.id})`,
    );
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.slice(0, limit).map(toComment);

  return {
    items,
    nextCursor:
      rows.length > limit && items.length > 0
        ? { createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id }
        : null,
  };
}

/** Окно ответов вокруг цели и курсор для продолжения вверх по треду. */
export async function listCommentThreadWindow(
  rootId: string,
  focus: Pick<Comment, 'id' | 'createdAt'>,
  limit = COMMENT_THREAD_PAGE_SIZE,
): Promise<{
  before: Comment[];
  after: Comment[];
  beforeCursor: CommentThreadCursor | null;
  afterCursor: CommentThreadCursor | null;
}> {
  const beforeFilter = `created_at.lt.${focus.createdAt},and(created_at.eq.${focus.createdAt},id.lt.${focus.id})`;
  const afterFilter = `created_at.gt.${focus.createdAt},and(created_at.eq.${focus.createdAt},id.gt.${focus.id})`;
  const base = () => commentsSelect().eq('thread_root_id', rootId).is('deleted_at', null);
  const [beforeResult, afterResult] = await Promise.all([
    base().or(beforeFilter).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1),
    base().or(afterFilter).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit + 1),
  ]);

  if (beforeResult.error) throw beforeResult.error;
  if (afterResult.error) throw afterResult.error;

  const beforeRows = beforeResult.data ?? [];
  const beforeItems = beforeRows.slice(0, limit).reverse().map(toComment);
  const first = beforeItems[0];
  const afterRows = afterResult.data ?? [];
  const afterItems = afterRows.slice(0, limit).map(toComment);
  const lastAfter = afterItems[afterItems.length - 1];

  return {
    before: beforeItems,
    after: afterItems,
    beforeCursor:
      beforeRows.length > limit && first ? { createdAt: first.createdAt, id: first.id } : null,
    afterCursor:
      afterRows.length > limit && lastAfter
        ? { createdAt: lastAfter.createdAt, id: lastAfter.id }
        : null,
  };
}

/** Следующая порция ответов перед текущим окном. */
export async function listCommentThreadRepliesBefore(
  rootId: string,
  cursor: CommentThreadCursor,
  limit = COMMENT_THREAD_PAGE_SIZE,
): Promise<{ items: Comment[]; previousCursor: CommentThreadCursor | null }> {
  const { data, error } = await commentsSelect()
    .eq('thread_root_id', rootId)
    .is('deleted_at', null)
    .or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.slice(0, limit).reverse().map(toComment);
  const first = items[0];

  return {
    items,
    previousCursor:
      rows.length > limit && first ? { createdAt: first.createdAt, id: first.id } : null,
  };
}

/** Соседи верхнего комментария по рангу, не загружая предшествующие страницы. */
export async function listCommentRootsAround(
  targetId: string,
  focus: Pick<Comment, 'rank' | 'id'>,
  limit = 5,
): Promise<Comment[]> {
  const [aboveResult, belowResult] = await Promise.all([
    commentsSelect()
      .eq('target_id', targetId)
      .is('thread_root_id', null)
      .or(`rank.gt.${focus.rank},and(rank.eq.${focus.rank},id.gt.${focus.id})`)
      .order('rank', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1),
    commentsSelect()
      .eq('target_id', targetId)
      .is('thread_root_id', null)
      .or(`rank.lt.${focus.rank},and(rank.eq.${focus.rank},id.lt.${focus.id})`)
      .order('rank', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
  ]);

  if (aboveResult.error) throw aboveResult.error;
  if (belowResult.error) throw belowResult.error;

  const above = (aboveResult.data ?? []).slice(0, limit).map(toComment).reverse();
  return [...above, ...(belowResult.data ?? []).map(toComment)];
}

/** Пришедшие после `since`, от старых к новым, — дочитывание по сигналу. */
export async function listCommentsSince(targetId: string, since: string): Promise<Comment[]> {
  const { data, error } = await commentsSelect()
    .eq('target_id', targetId)
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

/**
 * Фрагмент, к которому верхнеуровневый комментарий: готовый (чужой или свой) —
 * по id, свой новый — диапазоном (code points и кусок текста для сверки).
 */
export type CommentFragment = { id: string } | { start: number; end: number; text: string };

function toFragmentJson(fragment: CommentFragment) {
  return 'id' in fragment
    ? { id: fragment.id }
    : { start: fragment.start, end: fragment.end, text: fragment.text };
}

/** Текст или альбом с подписью — одной транзакцией, функцией `send_comment`. */
export async function sendComment(
  messageId: string,
  input: {
    text?: string;
    media?: SendMessageMedia[];
    replyTo?: string[];
    /** Тред ответа; без него — тред по цитатам или верхнеуровневый. */
    commentThreadRootId?: string | null;
    /** Фрагмент текста: готовый (`id`) или свой диапазон — база найдёт или создаст. */
    fragment?: CommentFragment;
  },
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_comment', {
    target_message: messageId,
    comment_text: input.text?.trim() ?? '',
    media: (input.media ?? []).map(toMediaJson),
    reply_to: input.replyTo?.length ? input.replyTo : undefined,
    thread_root: input.commentThreadRootId ?? undefined,
    fragment: input.fragment ? toFragmentJson(input.fragment) : undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('Не удалось отправить комментарий');

  return fetchComment(id);
}

/** Текст или альбом с подписью к попу — функцией `send_pop_comment`. */
export async function sendPopComment(
  popId: string,
  input: Parameters<typeof sendComment>[1],
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_pop_comment', {
    target_pop: popId,
    comment_text: input.text?.trim() ?? '',
    media: (input.media ?? []).map(toMediaJson),
    reply_to: input.replyTo?.length ? input.replyTo : undefined,
    thread_root: input.commentThreadRootId ?? undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('Не удалось отправить комментарий');

  return fetchComment(id);
}

/** Голосовое к попу — функцией `send_voice_pop_comment`. */
export async function sendVoicePopComment(
  popId: string,
  voice: SendVoiceInput,
  replyTo: string[] = [],
  commentThreadRootId: string | null = null,
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_voice_pop_comment', {
    target_pop: popId,
    voice: toVoiceJson(voice),
    reply_to: replyTo.length ? replyTo : undefined,
    thread_root: commentThreadRootId ?? undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('Не удалось отправить голосовое');

  return fetchComment(id);
}

/** Голосовое — функцией `send_voice_comment`: один файл-звук с длительностью. */
export async function sendVoiceComment(
  messageId: string,
  voice: SendVoiceInput,
  replyTo: string[] = [],
  commentThreadRootId: string | null = null,
  fragment?: CommentFragment,
): Promise<Comment> {
  const { data: id, error } = await supabase.rpc('send_voice_comment', {
    target_message: messageId,
    voice: toVoiceJson(voice),
    reply_to: replyTo.length ? replyTo : undefined,
    thread_root: commentThreadRootId ?? undefined,
    fragment: fragment ? toFragmentJson(fragment) : undefined,
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
    .from('comment_rows')
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
      authorName: data.author_id ? (data.author_name ?? 'Без имени') : null,
      authorAvatarUrl: data.author_avatar_url,
    };
  }

  const deleted = await listDeletedMessageIds([messageId]);

  return deleted.includes(messageId) ? { state: 'deleted' } : { state: 'missing' };
}

/**
 * Поп, к которому открыты комментарии. Удалённый SELECT-политика не отдаёт —
 * для панели это одно и то же: «Поп удалён», новых комментариев нет.
 */
export async function getPopCommentTarget(popId: string): Promise<CommentTarget> {
  const { data, error } = await supabase
    .from('pops')
    .select(
      'id, channel_id, comments_count, poster_url, caption, channel:channels(title, posts_chat_id)',
    )
    .eq('id', popId)
    .maybeSingle();

  if (error) throw error;

  if (!data?.channel) return { state: 'deleted' };

  return {
    state: 'pop',
    pop: {
      id: data.id,
      channelId: data.channel_id,
      channelTitle: data.channel.title,
      postsChatId: data.channel.posts_chat_id,
      commentsCount: data.comments_count,
      posterUrl: data.poster_url,
      caption: data.caption,
    },
  };
}

// =============================================================================
// Realtime
// =============================================================================

export type { CommentTopicListener as CommentChannelHandlers } from '@/api/commentTopics';

/**
 * Топик комментариев одного сообщения или попа. Открыт всем аутентифицированным —
 * комментарии публичны, — события в него кладёт только база. Канал общий
 * (`commentTopics`): его слушают и панель, и чаты с пересланными из этой
 * ветки комментариями. Отдаёт отписку: её обязательно звать в cleanup.
 */
export function subscribeToComments(targetId: string, handlers: CommentTopicListener): () => void {
  return acquireCommentTopic(targetId, handlers);
}
