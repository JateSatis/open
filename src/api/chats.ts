// Queries for the messenger. Chats and messages are publicly readable — the
// write side is guarded by RLS (`messages` accepts an insert only from a row
// in `chat_members`), so nothing here may assume the caller is a member.

import type { QueryData, RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

export const MESSAGE_PAGE_SIZE = 30;

export type ChatKind = 'direct' | 'group';

export type MessageKind = 'text' | 'photo' | 'video' | 'voice' | 'video_note' | 'system';

export type ChatParticipant = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Everything posted up to this moment has been seen by this participant. */
  lastReadAt: string;
};

export type ChatSummary = {
  id: string;
  kind: ChatKind;
  title: string | null;
  participants: ChatParticipant[];
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageAuthorId: string | null;
  /** True when the last message is somebody else's and arrived after my read mark. */
  hasUnread: boolean;
};

export type DirectCandidate = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
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

export type SendMessageInput = {
  text?: string;
  attachmentIds?: string[];
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

const CHAT_COLUMNS = 'id, kind, title, last_message_at, last_message_text, last_message_author_id';
const MEMBER_COLUMNS =
  'chat_id, user_id, last_read_at, profile:profiles(id, display_name, avatar_url)';
const MESSAGE_COLUMNS =
  'id, chat_id, author_id, kind, text, created_at, attachments(id, url, mime_type, width, height, duration_ms)';

// Заготовки запросов. Они же задают типы рядов: клиент разбирает select-строку
// вместе со встроенными таблицами, поэтому форма ответа выводится из самого
// запроса и не может разойтись со схемой — описывать ряды руками не нужно.
const chatsSelect = () => supabase.from('chats').select(CHAT_COLUMNS);
const membersSelect = () => supabase.from('chat_members').select(MEMBER_COLUMNS);
const messagesSelect = () => supabase.from('messages').select(MESSAGE_COLUMNS);

type ChatRow = QueryData<ReturnType<typeof chatsSelect>>[number];
type MemberRow = QueryData<ReturnType<typeof membersSelect>>[number];
type MessageRow = QueryData<ReturnType<typeof messagesSelect>>[number];

// `kind` в базе — текст с CHECK-ограничением, и генератор типов видит его как
// строку: сузить её больше негде, поэтому расхождение схемы с доменными
// типами живёт ровно в этих двух функциях.
const MESSAGE_KINDS = new Set<string>(['text', 'photo', 'video', 'voice', 'video_note', 'system']);

function toChatKind(kind: string): ChatKind {
  return kind === 'group' ? 'group' : 'direct';
}

/**
 * Вид, которого клиент не знает, показывается как системное сообщение: так
 * старое приложение переживает появление нового типа контента, не притворяясь,
 * что перед ним текст.
 */
function toMessageKind(kind: string): MessageKind {
  return MESSAGE_KINDS.has(kind) ? (kind as MessageKind) : 'system';
}
function toParticipant(row: MemberRow): ChatParticipant {
  const profile = row.profile;

  return {
    id: row.user_id,
    displayName: profile?.display_name ?? 'Без имени',
    avatarUrl: profile?.avatar_url ?? null,
    lastReadAt: row.last_read_at,
  };
}

function toMessage(row: MessageRow): Message {
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
      mimeType: attachment.mime_type,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.duration_ms,
    })),
  };
}

function toSummary(chat: ChatRow, members: MemberRow[], currentUserId: string): ChatSummary {
  const participants = members.map(toParticipant);
  const mine = participants.find((participant) => participant.id === currentUserId);

  return {
    id: chat.id,
    kind: toChatKind(chat.kind),
    title: chat.title,
    participants,
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

async function fetchMembers(chatIds: string[]): Promise<Map<string, MemberRow[]>> {
  const byChat = new Map<string, MemberRow[]>();

  if (chatIds.length === 0) return byChat;

  const { data, error } = await membersSelect().in('chat_id', chatIds);

  if (error) throw error;

  for (const row of data ?? []) {
    byChat.set(row.chat_id, [...(byChat.get(row.chat_id) ?? []), row]);
  }

  return byChat;
}

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
  const membersByChat = await fetchMembers(chats.map((chat) => chat.id));

  return chats.map((chat) => toSummary(chat, membersByChat.get(chat.id) ?? [], userId));
}

export async function getChat(chatId: string): Promise<ChatSummary> {
  const userId = await getCurrentUserId();

  const { data, error } = await chatsSelect().eq('id', chatId).is('deleted_at', null).maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Чат не найден');

  const chat = data;
  const membersByChat = await fetchMembers([chat.id]);

  return toSummary(chat, membersByChat.get(chat.id) ?? [], userId);
}

/**
 * Everyone except the signed-in user. A stand-in for search and contacts while
 * the product has neither — every account is reachable in one tap.
 */
export async function listDirectCandidates(): Promise<DirectCandidate[]> {
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
 * Id of the dialogue with this person, creating it on first use. Runs as a
 * database function: adding the second participant from the client would hit
 * the `chat_members` policy, and two taps at once would create two chats.
 */
export async function getOrCreateDirectChat(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_direct_chat', {
    other_user_id: otherUserId,
  });

  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Не удалось открыть диалог');

  return data;
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
export async function sendMessage(chatId: string, input: SendMessageInput): Promise<Message> {
  if (input.attachmentIds && input.attachmentIds.length > 0) {
    throw new Error('Вложения отправляет фича media, здесь они ещё не поддерживаются');
  }

  const text = input.text?.trim();

  if (!text) throw new Error('Пустое сообщение нельзя отправить');

  const authorId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, author_id: authorId, kind: 'text', text })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;

  return toMessage(data);
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

export type ChatChannelHandlers = {
  onMessage: () => void;
  onTyping: (userId: string) => void;
  onRead: () => void;
  /**
   * Канал заново подключился. Пока его не было, события терялись, поэтому
   * подписчик обязан дочитать пропущенное, а не ждать следующего сообщения.
   */
  onReconnected?: () => void;
};

export type ChatChannel = {
  broadcastTyping: (userId: string) => void;
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

export function subscribeToChat(chatId: string, handlers: ChatChannelHandlers): ChatChannel {
  // Private channels carry the user's token, which is what the policies on
  // realtime.messages check; without this the subscription is rejected.
  void supabase.realtime.setAuth();

  const channel: RealtimeChannel = supabase.channel(`chat:${chatId}`, {
    config: { private: true },
  });

  let wasJoined = false;

  channel
    .on('broadcast', { event: 'new_message' }, () => handlers.onMessage())
    .on('broadcast', { event: 'read' }, () => handlers.onRead())
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const userId = (payload as { userId?: string })?.userId;

      if (userId) handlers.onTyping(userId);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Первая подписка — не переподключение: историю в этот момент грузит
        // сам экран, и дочитывать нечего.
        if (wasJoined) handlers.onReconnected?.();

        wasJoined = true;
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        wasJoined = false;
      }
    });

  return {
    broadcastTyping: (userId: string) => {
      void channel.send({ type: 'broadcast', event: 'typing', payload: { userId } });
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

/**
 * Messages addressed to this user in any chat, used for the in-app alert.
 * The per-user topic is readable only by its owner.
 */
export function subscribeToIncomingMessages(
  userId: string,
  onMessage: (message: IncomingMessage) => void,
  onReconnected?: () => void,
): () => void {
  void supabase.realtime.setAuth();

  const channel: RealtimeChannel = supabase.channel(`user:${userId}`, {
    config: { private: true },
  });

  let wasJoined = false;

  channel
    .on('broadcast', { event: 'new_message' }, ({ payload }) => {
      const incoming = toIncoming(payload);

      if (incoming) onMessage(incoming);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (wasJoined) onReconnected?.();

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
