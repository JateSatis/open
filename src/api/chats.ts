// Queries for the messenger. Chats and messages are publicly readable — the
// write side is guarded by RLS (`messages` accepts an insert only from a row
// in `chat_members`), so nothing here may assume the caller is a member.
// Membership itself is never written from here: a chat is created and an
// invite answered only through database functions (see `invites.ts`).

import type { QueryData, RealtimeChannel } from '@supabase/supabase-js';

import { toPreview, type MessagePreview } from '@/api/messagePreview';
import { toReactions, type MessageReactions } from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

export { toPreview, type MessagePreview } from '@/api/messagePreview';

export const MESSAGE_PAGE_SIZE = 30;

export type ChatKind = 'direct' | 'group';

export type MessageKind = 'text' | 'photo' | 'video' | 'voice' | 'video_note' | 'system' | 'media';

/** Человек, как его показывают в списках: без ролей и состояний. */
export type Person = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ChatParticipant = Person & {
  /** Everything posted up to this moment has been seen by this participant. */
  lastReadAt: string;
};

export type ChatSummary = {
  id: string;
  kind: ChatKind;
  title: string | null;
  participants: ChatParticipant[];
  /**
   * Позванные, но ещё не принявшие заявку. Отказ здесь неотличим от молчания:
   * база отдаёт только «принял / ещё не принял» (см. `chat_waiting_invitees`).
   */
  waiting: Person[];
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageAuthorId: string | null;
  /** True when the last message is somebody else's and arrived after my read mark. */
  hasUnread: boolean;
};

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

/**
 * Цитата в ответе — ссылка на сообщение того же чата, а не копия: правки
 * оригинала видны в ней сразу. Удалённый оригинал база не отдаёт, и цитата
 * помнит только его id.
 */
export type QuotedMessage =
  | { messageId: string; state: 'deleted' }
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
    };

/** Откуда пересланное: первоисточник, а не промежуточное звено. */
export type ForwardOrigin = {
  authorId: string | null;
  /** `null` — аккаунт автора оригинала удалён. */
  authorName: string | null;
  /** Где оригинал сейчас. `null` — его удалили, копия при этом живёт. */
  original: { messageId: string; chatId: string; createdAt: string } | null;
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
  /** Пересланное: чьё оно на самом деле. `null` у своего сообщения. */
  forward: ForwardOrigin | null;
  /** Реакции по рядам и моя. */
  reactions: MessageReactions;
  /** Сколько живых комментариев. Денормализовано на сообщении, пишет база. */
  commentsCount: number;
  /** Метка звонка у системного сообщения; нет — это не звонок. */
  call?: CallMark | null;
};

/**
 * Уже загруженные в Storage файлы — форма, в которой их отдаёт
 * `uploadMedia()` из фичи `media`. Сжатие и заливка байт делает не этот
 * модуль: сюда приходят готовые URL, а он лишь связывает их с сообщением.
 */
export type SendMessageMedia = {
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
};

export type SendMessageInput = {
  text?: string;
  media?: SendMessageMedia[];
  /** Ответ: id сообщений того же чата, по порядку. */
  replyTo?: string[];
};

/** Загруженное голосовое: файл, длительность и форма волны. */
export type SendVoiceInput = {
  url: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  waveform: number[] | null;
};

/** Вложение итога правки: оставленное как есть или новый, уже загруженный файл. */
export type EditMediaItem = { attachmentId: string } | SendMessageMedia;
export type EditVoiceItem = { attachmentId: string } | SendVoiceInput;

/**
 * Итог правки целиком. Вид сообщения следует из содержимого: голосовое —
 * `voice`, есть файлы — `media`, иначе `text` (так решает и база).
 */
export type EditMessageInput = {
  text: string;
  media: EditMediaItem[];
  voice: EditVoiceItem | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

const CHAT_COLUMNS = 'id, kind, title, last_message_at, last_message_text, last_message_author_id';
const MEMBER_COLUMNS =
  'chat_id, user_id, last_read_at, profile:profiles(id, display_name, avatar_url)';
const WAITING_COLUMNS = 'chat_id, user_id, display_name, avatar_url';
// Цитаты и «переслано от» приходят той же выборкой, что и сами сообщения:
// страница переписки — один запрос, без догрузки на каждое облачко, и облачко
// не прыгает по высоте, когда цитата подтянулась. Реакции — там же: счётчики
// лежат на самом сообщении, своя — вычисляемой связью `my_reaction`. Подсказки
// внешних ключей нужны, потому что `messages` связана с `profiles` и сама с
// собой через несколько таблиц сразу.
export const MESSAGE_COLUMNS =
  'id, chat_id, author_id, kind, text, created_at, edited_at, attachments(id, url, poster_url, mime_type, width, height, duration_ms, waveform), replies:message_replies!message_replies_message_fkey(position, quoted_id, quoted:messages!message_replies_quoted_fkey(id, author_id, kind, text, created_at, edited_at, author:profiles!messages_author_id_fkey(display_name), attachments(url, poster_url, mime_type, duration_ms, position))), forward:message_forwards!message_forwards_message_fkey(origin_message_id, origin_author_id, origin_author:profiles(display_name), origin:messages!message_forwards_origin_fkey(id, chat_id, created_at)), member_reactions, visitor_reactions, my_reaction(emoji, audience), comments_count, stream_id, system_event, stream:streams!messages_stream_id_fkey(host_id, started_at, ended_at), my_call:my_stream_participation(id)';

// Заготовки запросов. Они же задают типы рядов: клиент разбирает select-строку
// вместе со встроенными таблицами, поэтому форма ответа выводится из самого
// запроса и не может разойтись со схемой — описывать ряды руками не нужно.
export const chatsSelect = () => supabase.from('chats').select(CHAT_COLUMNS);
const membersSelect = () => supabase.from('chat_members').select(MEMBER_COLUMNS);
const waitingSelect = () => supabase.from('chat_waiting_invitees').select(WAITING_COLUMNS);
// Мозаика в облачке должна собираться в порядке выбора файлов, а PostgREST
// не гарантирует порядок вложенной выборки сам по себе — нужен явный order
// по `position` (см. attachments_message_id_position_key в миграции).
export const messagesSelect = () =>
  supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .order('position', { referencedTable: 'attachments' });

type ChatRow = QueryData<ReturnType<typeof chatsSelect>>[number];
type MemberRow = QueryData<ReturnType<typeof membersSelect>>[number];
type WaitingRow = QueryData<ReturnType<typeof waitingSelect>>[number];
type MessageRow = QueryData<ReturnType<typeof messagesSelect>>[number];

// `kind` в базе — текст с CHECK-ограничением, и генератор типов видит его как
// строку: сузить её больше негде, поэтому расхождение схемы с доменными
// типами живёт ровно в этих двух функциях.
const MESSAGE_KINDS = new Set<string>([
  'text',
  'photo',
  'video',
  'voice',
  'video_note',
  'system',
  'media',
]);

function toChatKind(kind: string): ChatKind {
  return kind === 'group' ? 'group' : 'direct';
}

/**
 * Вид, которого клиент не знает, показывается как системное сообщение: так
 * старое приложение переживает появление нового типа контента, не притворяясь,
 * что перед ним текст.
 */
export function toMessageKind(kind: string): MessageKind {
  return MESSAGE_KINDS.has(kind) ? (kind as MessageKind) : 'system';
}

function toParticipant(row: MemberRow): ChatParticipant {
  return {
    id: row.user_id,
    displayName: row.profile?.display_name ?? 'Без имени',
    avatarUrl: row.profile?.avatar_url ?? null,
    lastReadAt: row.last_read_at,
  };
}

function toWaiting(row: WaitingRow): Person | null {
  // Колонки view генератор типов считает nullable целиком, хотя строка без
  // приглашённого в него не попадает.
  if (!row.user_id) return null;

  return {
    id: row.user_id,
    displayName: row.display_name ?? 'Без имени',
    avatarUrl: row.avatar_url,
  };
}

type ReplyRow = NonNullable<MessageRow['replies']>[number];

function toQuoted(row: ReplyRow): QuotedMessage {
  const quoted = row.quoted;

  // Оригинал приходит, только пока он жив: удалённое SELECT-политика не
  // отдаёт, а из другого чата цитаты не бывает (внешний ключ с chat_id).
  if (!quoted) return { messageId: row.quoted_id, state: 'deleted' };

  return {
    messageId: quoted.id,
    state: 'live',
    authorId: quoted.author_id,
    authorName: quoted.author_id ? (quoted.author?.display_name ?? 'Без имени') : null,
    createdAt: quoted.created_at,
    editedAt: quoted.edited_at,
    preview: toPreview(toMessageKind(quoted.kind), quoted.text, quoted.attachments ?? []),
  };
}

function toForward(row: MessageRow['forward'] | undefined): ForwardOrigin | null {
  if (!row) return null;

  // Аккаунт удалён — ссылка обнулилась; скрытый профиль база тоже не отдаёт.
  const hasAuthor = row.origin_author_id !== null && row.origin_author !== null;

  return {
    authorId: row.origin_author_id,
    authorName: hasAuthor ? (row.origin_author?.display_name ?? 'Без имени') : null,
    original: row.origin
      ? { messageId: row.origin.id, chatId: row.origin.chat_id, createdAt: row.origin.created_at }
      : null,
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

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    authorId: row.author_id,
    kind: toMessageKind(row.kind),
    text: row.text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    attachments: (row.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      posterUrl: attachment.poster_url,
      mimeType: attachment.mime_type,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.duration_ms,
      waveform: attachment.waveform,
    })),
    replies: [...(row.replies ?? [])].sort((a, b) => a.position - b.position).map(toQuoted),
    forward: toForward(row.forward),
    reactions: toReactions(row),
    commentsCount: row.comments_count,
    call: toCallMark(row),
  };
}

export type ChatPeople = { members: MemberRow[]; waiting: Person[] };

export function toSummary(chat: ChatRow, people: ChatPeople, currentUserId: string): ChatSummary {
  const participants = people.members.map(toParticipant);
  const mine = participants.find((participant) => participant.id === currentUserId);

  return {
    id: chat.id,
    kind: toChatKind(chat.kind),
    title: chat.title,
    participants,
    waiting: people.waiting,
    lastMessagePreview: chat.last_message_text,
    lastMessageAt: chat.last_message_at,
    lastMessageAuthorId: chat.last_message_author_id,
    hasUnread:
      chat.last_message_at !== null &&
      chat.last_message_author_id !== currentUserId &&
      mine !== undefined &&
      chat.last_message_at > mine.lastReadAt,
  };
}

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;
  if (!data.user) throw new Error('Нет активной сессии');

  return data.user.id;
}

/** Участники и ещё не принявшие — для нескольких чатов разом, двумя запросами. */
export async function fetchChatPeople(chatIds: string[]): Promise<Map<string, ChatPeople>> {
  const byChat = new Map<string, ChatPeople>();

  if (chatIds.length === 0) return byChat;

  const [members, waiting] = await Promise.all([
    membersSelect().in('chat_id', chatIds),
    waitingSelect().in('chat_id', chatIds).order('invited_at', { ascending: true }),
  ]);

  if (members.error) throw members.error;
  if (waiting.error) throw waiting.error;

  const entry = (chatId: string): ChatPeople => {
    const existing = byChat.get(chatId);

    if (existing) return existing;

    const created: ChatPeople = { members: [], waiting: [] };
    byChat.set(chatId, created);
    return created;
  };

  for (const row of members.data ?? []) {
    entry(row.chat_id).members.push(row);
  }

  for (const row of waiting.data ?? []) {
    const person = toWaiting(row);

    if (person && row.chat_id) entry(row.chat_id).waiting.push(person);
  }

  return byChat;
}

const NO_PEOPLE: ChatPeople = { members: [], waiting: [] };

/**
 * Chats the current user takes part in, most recent conversation first. The
 * preview comes from the denormalised columns on `chats`, kept up to date by a
 * trigger — reading the last message per chat would be one query per row.
 */
export async function listChats(): Promise<ChatSummary[]> {
  const userId = await getCurrentUserId();

  const { data: membershipData, error: membershipError } = await supabase
    .from('chat_members')
    .select('chat_id')
    .eq('user_id', userId);

  if (membershipError) throw membershipError;

  const chatIds = (membershipData ?? []).map((row) => row.chat_id);

  if (chatIds.length === 0) return [];

  const { data: chatData, error: chatError } = await chatsSelect()
    .in('id', chatIds)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (chatError) throw chatError;

  const chats = chatData ?? [];
  const peopleByChat = await fetchChatPeople(chats.map((chat) => chat.id));

  return chats.map((chat) => toSummary(chat, peopleByChat.get(chat.id) ?? NO_PEOPLE, userId));
}

export async function getChat(chatId: string): Promise<ChatSummary> {
  const userId = await getCurrentUserId();

  const { data, error } = await chatsSelect().eq('id', chatId).is('deleted_at', null).maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Чат не найден');

  const chat = data;
  const peopleByChat = await fetchChatPeople([chat.id]);

  return toSummary(chat, peopleByChat.get(chat.id) ?? NO_PEOPLE, userId);
}

/**
 * Everyone except the signed-in user. A stand-in for search and contacts while
 * the product has neither — every account is reachable in one tap.
 */
export async function listPeople(): Promise<Person[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .neq('id', userId)
    .is('deleted_at', null)
    .order('display_name', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name ?? 'Без имени',
    avatarUrl: row.avatar_url,
  }));
}

/**
 * Moves my read mark to now. The timestamp comes from the database, never from
 * the device: messages are stamped by the server, and a device clock running
 * even a few seconds behind would leave them unread forever.
 */
export async function markChatRead(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_chat_read', { target_chat: chatId });

  if (error) throw error;
}

/**
 * One page of a chat, newest first. There is deliberately no "load the whole
 * chat" call: `cursor` is the `createdAt` of the oldest message already shown
 * and each call walks further back.
 */
export async function listMessages(
  chatId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<Page<Message>> {
  const limit = params.limit ?? MESSAGE_PAGE_SIZE;

  let query = messagesSelect()
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.cursor) {
    query = query.lt('created_at', params.cursor);
  }

  const { data, error } = await query;

  if (error) throw error;

  const items = (data ?? []).map(toMessage);

  return {
    items,
    nextCursor: items.length === limit ? items[items.length - 1].createdAt : null,
  };
}

/**
 * Messages posted after `since`, oldest first. Used to settle a Realtime
 * broadcast: the payload is only a signal that something arrived, the rows
 * themselves always come from Postgres, where RLS decides what is visible.
 */
export async function listMessagesSince(chatId: string, since: string): Promise<Message[]> {
  const { data, error } = await messagesSelect()
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);

  if (error) throw error;

  return (data ?? []).map(toMessage);
}

/**
 * Inserts a text message. Membership is not checked here on purpose: the
 * insert policy on `messages` is the authority and a rejection surfaces as a
 * failed send in the UI.
 */
async function sendTextMessage(chatId: string, text: string): Promise<Message> {
  const authorId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, author_id: authorId, kind: 'text', text })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;

  return toMessage(data);
}

/**
 * Сообщение с вложениями идёт через `send_media_message` — функцию в базе,
 * которая вставляет сообщение и все его вложения одной транзакцией (см.
 * миграцию `20260922120000_message_media.sql`). Прямая последовательная
 * вставка с клиента не даёт такой гарантии: сообщение уже разошлось бы по
 * Broadcast раньше, чем к нему привязались бы все файлы.
 */
async function sendMediaMessage(
  chatId: string,
  text: string | null,
  media: SendMessageMedia[],
  replyTo: string[],
): Promise<Message> {
  const { data: newMessageId, error } = await supabase.rpc('send_media_message', {
    target_chat: chatId,
    // Функция в базе принимает `text`, допускающий NULL, но генератор типов
    // не размечает скалярные аргументы rpc как nullable — отсюда приведение.
    message_text: text as string,
    media: media.map((item) => ({
      url: item.url,
      poster_url: item.posterUrl,
      mime_type: item.mimeType,
      width: item.width,
      height: item.height,
      duration_ms: item.durationMs,
      size_bytes: item.sizeBytes,
    })),
    reply_to: replyTo.length > 0 ? replyTo : undefined,
  });

  if (error) throw error;
  if (typeof newMessageId !== 'string') throw new Error('Не удалось отправить сообщение');

  const { data, error: fetchError } = await messagesSelect().eq('id', newMessageId).single();

  if (fetchError) throw fetchError;

  return toMessage(data);
}

export async function sendMessage(chatId: string, input: SendMessageInput): Promise<Message> {
  const text = input.text?.trim() || null;
  const media = input.media ?? [];
  const replyTo = input.replyTo ?? [];

  if (!text && media.length === 0) throw new Error('Пустое сообщение нельзя отправить');

  // Ответ идёт через функцию и у текста: цитаты база принимает только в той
  // же транзакции, что и само сообщение (см. политику `message_replies`).
  return media.length === 0 && replyTo.length === 0
    ? sendTextMessage(chatId, text!)
    : sendMediaMessage(chatId, text, media, replyTo);
}

/**
 * Голосовое — через `send_voice_message`: сообщение и его единственное
 * вложение одной транзакцией. Что вложение ровно одно, что это звук и что у
 * него есть длительность, проверяет база (миграция голосовых), не клиент.
 */
export async function sendVoiceMessage(
  chatId: string,
  voice: SendVoiceInput,
  replyTo: string[] = [],
): Promise<Message> {
  const { data: newMessageId, error } = await supabase.rpc('send_voice_message', {
    target_chat: chatId,
    voice: {
      url: voice.url,
      mime_type: voice.mimeType,
      duration_ms: Math.round(voice.durationMs),
      size_bytes: voice.sizeBytes,
      waveform: voice.waveform,
    },
    reply_to: replyTo.length > 0 ? replyTo : undefined,
  });

  if (error) throw error;
  if (typeof newMessageId !== 'string') throw new Error('Не удалось отправить голосовое');

  const { data, error: fetchError } = await messagesSelect().eq('id', newMessageId).single();

  if (fetchError) throw fetchError;

  return toMessage(data);
}

/**
 * Пересылает сообщения в чат одной транзакцией — функцией `forward_messages`.
 * Она же проверяет, что я участник целевого чата, и ставит «переслано от»:
 * выставить атрибуцию сам клиент не может (миграция
 * `20260929100000_replies_and_forwards.sql`). Копии — в исходном порядке.
 */
export async function forwardMessages(chatId: string, messageIds: string[]): Promise<Message[]> {
  const { data: ids, error } = await supabase.rpc('forward_messages', {
    target_chat: chatId,
    message_ids: messageIds,
  });

  if (error) throw error;

  const created = (ids ?? []).filter((id): id is string => typeof id === 'string');

  if (created.length === 0) throw new Error('Не удалось переслать сообщения');

  const { data, error: fetchError } = await messagesSelect()
    .in('id', created)
    .order('created_at', { ascending: true });

  if (fetchError) throw fetchError;

  return (data ?? []).map(toMessage);
}

function isKept(item: EditMediaItem | EditVoiceItem): item is { attachmentId: string } {
  return 'attachmentId' in item;
}

/**
 * Правит своё сообщение — функцией `edit_message`, одной транзакцией: текст,
 * набор вложений и вид. Что сообщение моё, не переслано, не удалено и что
 * итог допустим (голосовое без подписи, непустое, альбом в пределах), решает
 * база (миграция `20260929180000_message_edit.sql`); время правки ставит она
 * же. Отдаёт сообщение, каким оно стало.
 */
export async function editMessage(messageId: string, input: EditMessageInput): Promise<Message> {
  const { error } = await supabase.rpc('edit_message', {
    target_message: messageId,
    message_text: input.text.trim(),
    media: input.media.map((item) =>
      isKept(item)
        ? { attachment_id: item.attachmentId }
        : {
            url: item.url,
            poster_url: item.posterUrl,
            mime_type: item.mimeType,
            width: item.width,
            height: item.height,
            duration_ms: item.durationMs,
            size_bytes: item.sizeBytes,
          },
    ),
    voice: input.voice
      ? isKept(input.voice)
        ? { attachment_id: input.voice.attachmentId }
        : {
            url: input.voice.url,
            mime_type: input.voice.mimeType,
            duration_ms: Math.round(input.voice.durationMs),
            size_bytes: input.voice.sizeBytes,
            waveform: input.voice.waveform,
          }
      : undefined,
  });

  if (error) throw error;

  const { data, error: fetchError } = await messagesSelect().eq('id', messageId).single();

  if (fetchError) throw fetchError;

  return toMessage(data);
}

/** Сколько комментариев у этих сообщений — свежие числа, пачкой. Удалённые база не отдаёт. */
export async function listCommentCounts(
  messageIds: string[],
): Promise<{ id: string; commentsCount: number }[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('id, comments_count')
    .in('id', messageIds)
    .is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map((row) => ({ id: row.id, commentsCount: row.comments_count }));
}

/** Сообщения по id — живые; удалённые база не отдаёт. */
export async function listMessagesByIds(messageIds: string[]): Promise<Message[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await messagesSelect().in('id', messageIds).is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map(toMessage);
}

/**
 * Время правки тех из этих сообщений, которые правили. Нужна, чтобы после
 * обрыва Realtime перечитать только изменившееся, а не всё загруженное.
 */
export async function listMessageEdits(
  messageIds: string[],
): Promise<{ id: string; editedAt: string }[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase.rpc('message_edits', { message_ids: messageIds });

  if (error) throw error;

  return (data ?? []).map((row) => ({ id: row.id, editedAt: row.edited_at }));
}

/**
 * Удаляет свои сообщения для всех — мягко, строки остаются с `deleted_at`.
 * Что все они мои и из одного чата, проверяет база: чужое в пачке отвергает
 * её целиком (см. миграцию `20260927100000_message_delete_and_pins.sql`).
 */
export async function deleteMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;

  const { error } = await supabase.rpc('delete_messages', { message_ids: messageIds });

  if (error) throw error;
}

/**
 * Какие из этих сообщений удалены. Обычная выборка удалённое просто не
 * отдаёт, а отличить «удалено» от «не загрузилось» нужно — например, чтобы
 * после обрыва Realtime убрать с экрана то, что удалили без нас.
 */
export async function listDeletedMessageIds(messageIds: string[]): Promise<string[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase.rpc('message_tombstones', { message_ids: messageIds });

  if (error) throw error;

  return (data ?? []).map((row) => row.id);
}

// =============================================================================
// Realtime
// =============================================================================
//
// Messages travel over Broadcast, not Postgres Changes: Postgres Changes
// re-evaluates RLS per subscriber on every write and does not survive a public
// messenger. `new_message` and `read` are emitted by database triggers, so
// delivery does not depend on the sender's app still being alive; `typing` is
// ephemeral and stays a client-to-client event.
//
// The payload is only a notification — rows are always re-read from Postgres,
// so a forged broadcast cannot put a message into anyone's chat.

export type IncomingMessage = {
  messageId: string;
  chatId: string;
  authorId: string | null;
  authorName: string;
  /** Вид сообщения; у старой базы — нет. О звонке сообщает входящий, а не карточка. */
  messageKind: string | null;
  text: string | null;
  createdAt: string;
};

/** Что человек делает прямо сейчас — для «печатает…» и «записывает голосовое…». */
export type ChatActivity = 'typing' | 'recording_voice';

export type ChatChannelHandlers = {
  onMessage: () => void;
  onTyping: (userId: string, activity: ChatActivity) => void;
  onRead: () => void;
  /** Кто-то принял заявку: состав участников изменился. */
  onMembersChanged: () => void;
  /**
   * Сообщения удалены. Payload — только подсказка, какие: подделать событие
   * может любой, поэтому что удалено на самом деле, подписчик спрашивает у
   * базы.
   */
  onMessagesDeleted: (messageIds: string[]) => void;
  /** Сообщение отредактировано. Как и у удаления, payload — только подсказка, какое. */
  onMessageEdited: (messageId: string) => void;
  /** Закрепы чата изменились — полосу пора перечитать. */
  onPinsChanged: () => void;
  /** Реакции на сообщение изменились. Payload — подсказка, какое; счётчики — из базы. */
  onReactionsChanged: (messageId: string) => void;
  /** Число комментариев к сообщению изменилось. Payload — подсказка, какое; число — из базы. */
  onCommentsChanged: (messageId: string) => void;
  /** Звонок в чате начался, изменился его состав или он завершился. */
  onStreamChanged?: () => void;
  /**
   * Канал заново подключился. Пока его не было, события терялись, поэтому
   * подписчик обязан дочитать пропущенное, а не ждать следующего сообщения.
   */
  onReconnected?: () => void;
};

export type ChatChannel = {
  broadcastTyping: (userId: string, activity?: ChatActivity) => void;
  unsubscribe: () => void;
};

function toIncoming(payload: unknown): IncomingMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const row = payload as Record<string, unknown>;

  if (typeof row.chat_id !== 'string' || typeof row.message_id !== 'string') return null;

  return {
    messageId: row.message_id,
    chatId: row.chat_id,
    authorId: typeof row.author_id === 'string' ? row.author_id : null,
    authorName: typeof row.author_name === 'string' ? row.author_name : 'Без имени',
    messageKind: typeof row.kind === 'string' ? row.kind : null,
    text: typeof row.text === 'string' ? row.text : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

function toActivity(value: unknown): ChatActivity {
  return value === 'recording_voice' ? value : 'typing';
}

export function subscribeToChat(chatId: string, handlers: ChatChannelHandlers): ChatChannel {
  // Private channels carry the user's token, which is what the policies on
  // realtime.messages check; without this the subscription is rejected.
  void supabase.realtime.setAuth();

  const channel: RealtimeChannel = supabase.channel(`chat:${chatId}`, {
    config: { private: true },
  });

  let joinedBefore = false;

  channel
    .on('broadcast', { event: 'new_message' }, () => handlers.onMessage())
    .on('broadcast', { event: 'read' }, () => handlers.onRead())
    .on('broadcast', { event: 'member_joined' }, () => handlers.onMembersChanged())
    .on('broadcast', { event: 'messages_deleted' }, ({ payload }) => {
      const ids = (payload as { message_ids?: unknown } | undefined)?.message_ids;

      handlers.onMessagesDeleted(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      );
    })
    .on('broadcast', { event: 'message_edited' }, ({ payload }) => {
      const id = (payload as { message_id?: unknown } | undefined)?.message_id;

      if (typeof id === 'string') handlers.onMessageEdited(id);
    })
    .on('broadcast', { event: 'pins_changed' }, () => handlers.onPinsChanged())
    .on('broadcast', { event: 'reactions_changed' }, ({ payload }) => {
      const id = (payload as { message_id?: unknown } | undefined)?.message_id;

      if (typeof id === 'string') handlers.onReactionsChanged(id);
    })
    .on('broadcast', { event: 'comments_changed' }, ({ payload }) => {
      const id = (payload as { message_id?: unknown } | undefined)?.message_id;

      if (typeof id === 'string') handlers.onCommentsChanged(id);
    })
    .on('broadcast', { event: 'stream_changed' }, () => handlers.onStreamChanged?.())
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const { userId, activity } = (payload ?? {}) as { userId?: unknown; activity?: unknown };

      // Событие без `activity` — от версии приложения до голосовых: это набор текста.
      if (typeof userId === 'string') handlers.onTyping(userId, toActivity(activity));
    })
    .subscribe((status) => {
      // Первая подписка — не переподключение: историю в этот момент грузит
      // сам экран, и дочитывать нечего. Любая следующая — после обрыва, и
      // флаг при ошибке не сбрасывается: иначе повторное подключение
      // выглядело бы первым и пропущенное так и осталось бы пропущенным.
      if (status !== 'SUBSCRIBED') return;

      if (joinedBefore) handlers.onReconnected?.();

      joinedBefore = true;
    });

  return {
    broadcastTyping: (userId: string, activity: ChatActivity = 'typing') => {
      void channel.send({ type: 'broadcast', event: 'typing', payload: { userId, activity } });
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

export type IncomingInvite = {
  chatId: string;
  inviterId: string | null;
  inviterName: string;
  chatTitle: string | null;
};

function toInvite(payload: unknown): IncomingInvite | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const row = payload as Record<string, unknown>;

  if (typeof row.chat_id !== 'string') return null;

  return {
    chatId: row.chat_id,
    inviterId: typeof row.inviter_id === 'string' ? row.inviter_id : null,
    inviterName: typeof row.inviter_name === 'string' ? row.inviter_name : 'Без имени',
    chatTitle: typeof row.chat_title === 'string' ? row.chat_title : null,
  };
}

function chatIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const chatId = (payload as Record<string, unknown>).chat_id;

  return typeof chatId === 'string' ? chatId : null;
}

export type UserChannelHandlers = {
  onMessage: (message: IncomingMessage) => void;
  /** Меня позвали в чат. */
  onInvite: (invite: IncomingInvite) => void;
  /**
   * Заявка изменилась: я ответил (возможно, с другого устройства) или в чат,
   * куда меня зовут, написали — карточке заявки пора перечитать превью.
   */
  onInviteChanged: (chatId: string) => void;
  /** В чат, где я участник, вошёл принявший заявку. */
  onMemberJoined: (chatId: string) => void;
  /** Превью чата изменилось не из-за нового сообщения — например, последнее удалили. */
  onChatChanged: (chatId: string) => void;
  /** Мне звонят: в чате, где я участник, начали звонок. */
  onIncomingCall?: (call: IncomingCall) => void;
  /** Звонок в чате, где я участник, завершился — входящий пора погасить. */
  onStreamEnded?: (streamId: string, chatId: string) => void;
  onReconnected?: () => void;
};

export type IncomingCall = {
  streamId: string;
  chatId: string;
  chatTitle: string | null;
  chatKind: ChatKind;
  hostId: string | null;
  hostName: string;
  startedAt: string;
};

function toIncomingCall(payload: unknown): IncomingCall | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const row = payload as Record<string, unknown>;

  if (typeof row.stream_id !== 'string' || typeof row.chat_id !== 'string') return null;

  return {
    streamId: row.stream_id,
    chatId: row.chat_id,
    chatTitle: typeof row.chat_title === 'string' ? row.chat_title : null,
    chatKind: row.chat_kind === 'group' ? 'group' : 'direct',
    hostId: typeof row.host_id === 'string' ? row.host_id : null,
    hostName: typeof row.host_name === 'string' ? row.host_name : 'Без имени',
    startedAt: typeof row.started_at === 'string' ? row.started_at : new Date().toISOString(),
  };
}

/**
 * Everything addressed to this user personally: messages in any chat, invites
 * and membership changes. The per-user topic is readable only by its owner.
 * One channel for all of them — Realtime keeps a single channel per topic, so
 * a second subscriber to `user:<id>` would not get its own.
 */
export function subscribeToUserEvents(userId: string, handlers: UserChannelHandlers): () => void {
  void supabase.realtime.setAuth();

  const channel: RealtimeChannel = supabase.channel(`user:${userId}`, {
    config: { private: true },
  });

  let wasJoined = false;

  channel
    .on('broadcast', { event: 'new_message' }, ({ payload }) => {
      const incoming = toIncoming(payload);

      if (incoming) handlers.onMessage(incoming);
    })
    .on('broadcast', { event: 'invite' }, ({ payload }) => {
      const invite = toInvite(payload);

      if (invite) handlers.onInvite(invite);
    })
    .on('broadcast', { event: 'invite_changed' }, ({ payload }) => {
      const chatId = chatIdOf(payload);

      if (chatId) handlers.onInviteChanged(chatId);
    })
    .on('broadcast', { event: 'invite_activity' }, ({ payload }) => {
      const chatId = chatIdOf(payload);

      if (chatId) handlers.onInviteChanged(chatId);
    })
    .on('broadcast', { event: 'member_joined' }, ({ payload }) => {
      const chatId = chatIdOf(payload);

      if (chatId) handlers.onMemberJoined(chatId);
    })
    .on('broadcast', { event: 'chat_changed' }, ({ payload }) => {
      const chatId = chatIdOf(payload);

      if (chatId) handlers.onChatChanged(chatId);
    })
    .on('broadcast', { event: 'incoming_call' }, ({ payload }) => {
      const call = toIncomingCall(payload);

      if (call) handlers.onIncomingCall?.(call);
    })
    .on('broadcast', { event: 'stream_ended' }, ({ payload }) => {
      const chatId = chatIdOf(payload);
      const streamId = (payload as { stream_id?: unknown } | undefined)?.stream_id;

      if (chatId && typeof streamId === 'string') handlers.onStreamEnded?.(streamId, chatId);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (wasJoined) handlers.onReconnected?.();

        wasJoined = true;
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        wasJoined = false;
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Presence of everyone currently in the app, used for the "в сети" status in
 * the chat list. Returns the unsubscribe function — leaking this channel is
 * what makes Realtime go quiet after a few screen transitions.
 */
export function subscribeToOnlineUsers(
  userId: string,
  onChange: (userIds: string[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase.channel('presence:online', {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => onChange(Object.keys(channel.presenceState())))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ onlineAt: new Date().toISOString() });
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
