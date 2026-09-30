// Сообщение в том виде, в каком его видит приложение, и разбор его из
// выборки. Страница переписки — один запрос: цитаты, реакции, звонок и
// островки пересылки с оригиналами приходят той же выборкой, без догрузки на
// каждое облачко, и облачко не прыгает по высоте, когда что-то подтянулось.

import type { QueryData } from '@supabase/supabase-js';

import { toPreview, type MessagePreview } from '@/api/messagePreview';
import { toReactions, type MessageReactions } from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

export type MessageKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'voice'
  | 'video_note'
  | 'system'
  | 'media'
  | 'forward';

/**
 * Shape of a message attachment as the rest of the app consumes it. Recording,
 * upload and playback belong to the `media` feature — the messenger only
 * carries the descriptor through so a message can already be rendered with it.
 */
export type MessageAttachment = {
  id: string;
  url: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Кадр видео для плитки и ленты. У фото и у видео, отправленных до постеров, — `null`. */
  posterUrl: string | null;
  /** Форма волны голосового, столбики 0..31. У остального — `null`. */
  waveform: number[] | null;
};

/** Где в этом чате стоит сообщение из другого чата: островок, который его держит. */
export type IslandAnchor = { forwardId: string; createdAt: string };

/**
 * Цитата в ответе — ссылка на сообщение, а не копия: правки оригинала видны в
 * ней сразу. Удалённый оригинал база не отдаёт, и цитата помнит только его id.
 * Цитата из островка — оригинал из другого чата; `via` — островок этого чата,
 * где он стоит.
 */
export type QuotedMessage =
  | { messageId: string; state: 'deleted'; via?: IslandAnchor | null }
  | {
      messageId: string;
      state: 'live';
      authorId: string | null;
      /** `null` — аккаунт автора удалён. */
      authorName: string | null;
      createdAt: string;
      /** Когда оригинал правили в последний раз — чтобы узнать, что цитата устарела. */
      editedAt: string | null;
      preview: MessagePreview;
      via?: IslandAnchor | null;
    };

/**
 * Системное сообщение о звонке: начат или завершён. Кто начал, сколько шёл и
 * был ли я в нём — из самого звонка, а не из текста сообщения.
 */
export type CallMark = {
  streamId: string;
  event: 'call_started' | 'call_ended';
  hostId: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Я входил в этот звонок (хоть раз). */
  joinedByMe: boolean;
};

/** Чат, как его называют чужому глазу: заданное название или люди. */
export type ChatRef = { id: string; name: string };

/** Чат оригинала глазами смотрящего: от него зависят ряд реакций и «прочитано». */
export type OriginChat = ChatRef & {
  /** До какого момента чат прочитали все, кроме меня. */
  readUpTo: string | null;
  /** Я участник этого чата — моя реакция ляжет в ряд участников. */
  amMember: boolean;
};

/** Оригинал в островке — само сообщение, с автором и чатом, которых нет среди участников этого чата. */
export type IslandOriginal = Message & {
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
  /** `null` — чат оригинала удалён. */
  chat: OriginChat | null;
};

/** Позиция островка. `original: null` — оригинал удалён, на его месте заглушка. */
export type IslandItem = {
  id: string;
  position: number;
  messageId: string;
  original: IslandOriginal | null;
};

/**
 * Островок пересылки: не сообщение, а ссылки на оригиналы по порядку и чат,
 * откуда пересылали.
 */
export type ForwardIsland = {
  /** `null` — чат-заголовок удалён. */
  sourceChat: ChatRef | null;
  items: IslandItem[];
};

export type Message = {
  id: string;
  chatId: string;
  authorId: string | null;
  kind: MessageKind;
  text: string | null;
  createdAt: string;
  /** Время последней правки, серверное. `null` — сообщение не правили. */
  editedAt: string | null;
  attachments: MessageAttachment[];
  /** На что это ответ — по порядку. Пусто у обычного сообщения. */
  replies: QuotedMessage[];
  /** Островок пересылки (вид `forward`): что переслано и откуда. У остальных — `null`. */
  forward: ForwardIsland | null;
  /** Реакции по рядам и моя. */
  reactions: MessageReactions;
  /** Сколько живых комментариев. Денормализовано на сообщении, пишет база. */
  commentsCount: number;
  /** Метка звонка у системного сообщения; нет — это не звонок. */
  call?: CallMark | null;
};

const ATTACHMENT_COLUMNS = 'id, url, poster_url, mime_type, width, height, duration_ms, waveform, position';
// Подсказки внешних ключей нужны, потому что `messages` связана с `profiles`,
// `chats` и сама с собой через несколько таблиц сразу.
const REPLY_COLUMNS =
  'replies:message_replies!message_replies_message_fkey(position, quoted_id, via:messages!message_replies_quoted_forward_fkey(id, created_at), quoted:messages!message_replies_quoted_fkey(id, author_id, kind, text, created_at, edited_at, author:profiles!messages_author_id_fkey(display_name), attachments(url, poster_url, mime_type, duration_ms, position)))';
const REACTION_AND_COMMENT_COLUMNS =
  'member_reactions, visitor_reactions, my_reaction(emoji, audience), comments_count';
const ORIGINAL_COLUMNS = `id, chat_id, author_id, kind, text, created_at, edited_at, attachments(${ATTACHMENT_COLUMNS}), ${REPLY_COLUMNS}, ${REACTION_AND_COMMENT_COLUMNS}, author:profiles!messages_author_id_fkey(display_name, avatar_url), chat:chats!messages_chat_id_fkey(id, chat_display_name, chat_read_up_to, chat_am_member)`;

// Островок приходит сразу с оригиналами: их текст, файлы, автор, чат,
// реакции и комментарии — той же выборкой. Своя реакция — вычисляемой связью
// `my_reaction`, и у оригинала тоже.
export const MESSAGE_COLUMNS =
  `id, chat_id, author_id, kind, text, created_at, edited_at, attachments(${ATTACHMENT_COLUMNS}), ${REPLY_COLUMNS}, ${REACTION_AND_COMMENT_COLUMNS}, stream_id, system_event, stream:streams!messages_stream_id_fkey(host_id, started_at, ended_at), my_call:my_stream_participation(id), source_chat:chats!messages_source_chat_id_fkey(id, chat_display_name), items:forward_items!forward_items_forward_fkey(id, position, message_id, original:messages!forward_items_message_fkey(${ORIGINAL_COLUMNS}))` as const;

// Мозаика в облачке должна собираться в порядке выбора файлов, а PostgREST
// не гарантирует порядок вложенной выборки сам по себе — нужен явный order
// по `position` (см. attachments_message_id_position_key в миграции). Во
// вложенных оригиналах порядок наводит разбор ниже.
export const messagesSelect = () =>
  supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .order('position', { referencedTable: 'attachments' });

type MessageRow = QueryData<ReturnType<typeof messagesSelect>>[number];
type ReplyRow = NonNullable<MessageRow['replies']>[number];
type AttachmentRow = NonNullable<MessageRow['attachments']>[number];
type ItemRow = NonNullable<MessageRow['items']>[number];
type OriginalRow = NonNullable<ItemRow['original']>;

// `kind` в базе — текст с CHECK-ограничением, и генератор типов видит его как
// строку: сузить её больше негде, поэтому расхождение схемы с доменными
// типами живёт ровно здесь.
const MESSAGE_KINDS = new Set<string>([
  'text',
  'photo',
  'video',
  'voice',
  'video_note',
  'system',
  'media',
  'forward',
]);

/**
 * Вид, которого клиент не знает, показывается как системное сообщение: так
 * старое приложение переживает появление нового типа контента, не притворяясь,
 * что перед ним текст.
 */
export function toMessageKind(kind: string): MessageKind {
  return MESSAGE_KINDS.has(kind) ? (kind as MessageKind) : 'system';
}

function toAttachments(rows: AttachmentRow[] | null | undefined): MessageAttachment[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      posterUrl: attachment.poster_url,
      mimeType: attachment.mime_type,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.duration_ms,
      waveform: attachment.waveform,
    }));
}

function toQuoted(row: ReplyRow): QuotedMessage {
  const quoted = row.quoted;
  const via = row.via ? { forwardId: row.via.id, createdAt: row.via.created_at } : null;

  // Оригинал приходит, только пока он жив: удалённое SELECT-политика не отдаёт.
  if (!quoted) return { messageId: row.quoted_id, state: 'deleted', via };

  return {
    messageId: quoted.id,
    state: 'live',
    authorId: quoted.author_id,
    authorName: quoted.author_id ? (quoted.author?.display_name ?? 'Без имени') : null,
    createdAt: quoted.created_at,
    editedAt: quoted.edited_at,
    preview: toPreview(toMessageKind(quoted.kind), quoted.text, quoted.attachments ?? []),
    via,
  };
}

function toCallMark(row: MessageRow): CallMark | null {
  if (!row.stream_id || !row.stream) return null;
  if (row.system_event !== 'call_started' && row.system_event !== 'call_ended') return null;

  return {
    streamId: row.stream_id,
    event: row.system_event,
    hostId: row.stream.host_id,
    startedAt: row.stream.started_at,
    endedAt: row.stream.ended_at,
    joinedByMe: row.my_call !== null && row.my_call !== undefined,
  };
}

type ContentRow = Pick<
  OriginalRow,
  | 'id'
  | 'chat_id'
  | 'author_id'
  | 'kind'
  | 'text'
  | 'created_at'
  | 'edited_at'
  | 'attachments'
  | 'replies'
  | 'member_reactions'
  | 'visitor_reactions'
  | 'my_reaction'
  | 'comments_count'
>;

function toContent(row: ContentRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    authorId: row.author_id,
    kind: toMessageKind(row.kind),
    text: row.text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    attachments: toAttachments(row.attachments),
    replies: [...(row.replies ?? [])].sort((a, b) => a.position - b.position).map(toQuoted),
    forward: null,
    reactions: toReactions(row),
    commentsCount: row.comments_count,
  };
}

function toOriginal(row: OriginalRow): IslandOriginal {
  return {
    ...toContent(row),
    // Аккаунт удалён — ссылка обнулилась; скрытый профиль база тоже не отдаёт.
    authorName: row.author_id && row.author ? (row.author.display_name ?? 'Без имени') : null,
    authorAvatarUrl: row.author?.avatar_url ?? null,
    chat: row.chat
      ? {
          id: row.chat.id,
          name: row.chat.chat_display_name ?? 'Чат',
          readUpTo: row.chat.chat_read_up_to,
          amMember: row.chat.chat_am_member === true,
        }
      : null,
  };
}

function toIsland(row: MessageRow): ForwardIsland | null {
  if (row.kind !== 'forward') return null;

  return {
    sourceChat: row.source_chat
      ? { id: row.source_chat.id, name: row.source_chat.chat_display_name ?? 'Чат' }
      : null,
    items: [...(row.items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        position: item.position,
        messageId: item.message_id,
        // Оригинал удалён — SELECT-политика его не отдаёт: заглушка.
        original: item.original ? toOriginal(item.original) : null,
      })),
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    ...toContent(row),
    forward: toIsland(row),
    call: toCallMark(row),
  };
}
