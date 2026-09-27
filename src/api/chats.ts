// Queries for the messenger. Chats and messages are publicly readable — the
// write side is guarded by RLS (`messages` accepts an insert only from a row
// in `chat_members`), so nothing here may assume the caller is a member.
// Membership itself is never written from here: a chat is created and an
// invite answered only through database functions (see `invites.ts`).

import type { QueryData, RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

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

export type Message = {
  id: string;
  chatId: string;
  authorId: string | null;
  kind: MessageKind;
  text: string | null;
  createdAt: string;
  attachments: MessageAttachment[];
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
};

/** Загруженное голосовое: файл, длительность и форма волны. */
export type SendVoiceInput = {
  url: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  waveform: number[] | null;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

const CHAT_COLUMNS = 'id, kind, title, last_message_at, last_message_text, last_message_author_id';
const MEMBER_COLUMNS =
  'chat_id, user_id, last_read_at, profile:profiles(id, display_name, avatar_url)';
const WAITING_COLUMNS = 'chat_id, user_id, display_name, avatar_url';
export const MESSAGE_COLUMNS =
  'id, chat_id, author_id, kind, text, created_at, attachments(id, url, poster_url, mime_type, width, height, duration_ms, waveform)';

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

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    authorId: row.author_id,
    kind: toMessageKind(row.kind),
    text: row.text,
    createdAt: row.created_at,
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

  if (!text && media.length === 0) throw new Error('Пустое сообщение нельзя отправить');

  return media.length === 0
    ? sendTextMessage(chatId, text!)
    : sendMediaMessage(chatId, text, media);
}

/**
 * Голосовое — через `send_voice_message`: сообщение и его единственное
 * вложение одной транзакцией. Что вложение ровно одно, что это звук и что у
 * него есть длительность, проверяет база (миграция голосовых), не клиент.
 */
export async function sendVoiceMessage(chatId: string, voice: SendVoiceInput): Promise<Message> {
  const { data: newMessageId, error } = await supabase.rpc('send_voice_message', {
    target_chat: chatId,
    voice: {
      url: voice.url,
      mime_type: voice.mimeType,
      duration_ms: Math.round(voice.durationMs),
      size_bytes: voice.sizeBytes,
      waveform: voice.waveform,
    },
  });

  if (error) throw error;
  if (typeof newMessageId !== 'string') throw new Error('Не удалось отправить голосовое');

  const { data, error: fetchError } = await messagesSelect().eq('id', newMessageId).single();

  if (fetchError) throw fetchError;

  return toMessage(data);
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
  /** Закрепы чата изменились — полосу пора перечитать. */
  onPinsChanged: () => void;
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
    .on('broadcast', { event: 'pins_changed' }, () => handlers.onPinsChanged())
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
  onReconnected?: () => void;
};

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
