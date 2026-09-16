// Queries for the messenger. Chats and messages are publicly readable — the
// write side is guarded by RLS (`messages` accepts an insert only from a row
// in `chat_members`), so nothing here may assume the caller is a member.
//
// Row types are declared by hand: `src/api/types.gen.ts` does not exist yet
// (it is generated from the schema by a human, see CLAUDE.md section 2a) and
// the shared Supabase client is therefore still untyped.

import { supabase } from '@/api/supabase';

export const MESSAGE_PAGE_SIZE = 30;

export type ChatKind = 'direct' | 'group';

export type MessageKind = 'text' | 'photo' | 'video' | 'voice' | 'video_note' | 'system';

export type ChatParticipant = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ChatSummary = {
  id: string;
  kind: ChatKind;
  title: string | null;
  participants: ChatParticipant[];
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
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

type ChatRow = {
  id: string;
  kind: ChatKind;
  title: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

// PostgREST returns a single object for a many-to-one embed, but the untyped
// client cannot know that and infers an array — accept both shapes.
type MemberRow = {
  chat_id: string;
  user_id: string;
  profile: ProfileRow | ProfileRow[] | null;
};

type AttachmentRow = {
  id: string;
  url: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};

type MessageRow = {
  id: string;
  chat_id: string;
  author_id: string | null;
  kind: MessageKind;
  text: string | null;
  created_at: string;
  attachments: AttachmentRow[] | null;
};

const CHAT_COLUMNS = 'id, kind, title';
const MEMBER_COLUMNS = 'chat_id, user_id, profile:profiles(id, display_name, avatar_url)';
const MESSAGE_COLUMNS =
  'id, chat_id, author_id, kind, text, created_at, attachments(id, url, mime_type, width, height, duration_ms)';

function toParticipant(row: MemberRow): ChatParticipant {
  const profile = Array.isArray(row.profile) ? (row.profile[0] ?? null) : row.profile;

  return {
    id: row.user_id,
    displayName: profile?.display_name ?? 'Без имени',
    avatarUrl: profile?.avatar_url ?? null,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    authorId: row.author_id,
    kind: row.kind,
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

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;
  if (!data.user) throw new Error('Нет активной сессии');

  return data.user.id;
}

async function fetchParticipants(chatIds: string[]): Promise<Map<string, ChatParticipant[]>> {
  const byChat = new Map<string, ChatParticipant[]>();

  if (chatIds.length === 0) return byChat;

  const { data, error } = await supabase
    .from('chat_members')
    .select(MEMBER_COLUMNS)
    .in('chat_id', chatIds);

  if (error) throw error;

  for (const row of (data ?? []) as MemberRow[]) {
    const participants = byChat.get(row.chat_id) ?? [];
    participants.push(toParticipant(row));
    byChat.set(row.chat_id, participants);
  }

  return byChat;
}

async function fetchLastMessage(chatId: string): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  const rows = (data ?? []) as MessageRow[];

  return rows.length > 0 ? toMessage(rows[0]) : null;
}

/**
 * Chats the current user takes part in, most recent conversation first.
 *
 * The last message is fetched per chat because the schema has no denormalised
 * `last_message_at` yet; adding one (plus a trigger) needs a migration, which
 * is a human's call — see the task report.
 */
export async function listChats(): Promise<ChatSummary[]> {
  const userId = await getCurrentUserId();

  const { data: membershipData, error: membershipError } = await supabase
    .from('chat_members')
    .select('chat_id')
    .eq('user_id', userId);

  if (membershipError) throw membershipError;

  const chatIds = ((membershipData ?? []) as { chat_id: string }[]).map((row) => row.chat_id);

  if (chatIds.length === 0) return [];

  const { data: chatData, error: chatError } = await supabase
    .from('chats')
    .select(CHAT_COLUMNS)
    .in('id', chatIds)
    .is('deleted_at', null);

  if (chatError) throw chatError;

  const chats = (chatData ?? []) as ChatRow[];
  const participantsByChat = await fetchParticipants(chats.map((chat) => chat.id));
  const lastMessages = await Promise.all(chats.map((chat) => fetchLastMessage(chat.id)));

  const summaries = chats.map((chat, index): ChatSummary => {
    const lastMessage = lastMessages[index];

    return {
      id: chat.id,
      kind: chat.kind,
      title: chat.title,
      participants: participantsByChat.get(chat.id) ?? [],
      lastMessagePreview: lastMessage?.text ?? null,
      lastMessageAt: lastMessage?.createdAt ?? null,
    };
  });

  return summaries.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

export async function getChat(chatId: string): Promise<ChatSummary> {
  const { data, error } = await supabase
    .from('chats')
    .select(CHAT_COLUMNS)
    .eq('id', chatId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Чат не найден');

  const chat = data as ChatRow;
  const participantsByChat = await fetchParticipants([chat.id]);
  const lastMessage = await fetchLastMessage(chat.id);

  return {
    id: chat.id,
    kind: chat.kind,
    title: chat.title,
    participants: participantsByChat.get(chat.id) ?? [],
    lastMessagePreview: lastMessage?.text ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
  };
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

  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.cursor) {
    query = query.lt('created_at', params.cursor);
  }

  const { data, error } = await query;

  if (error) throw error;

  const items = ((data ?? []) as MessageRow[]).map(toMessage);

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
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('chat_id', chatId)
    .is('deleted_at', null)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);

  if (error) throw error;

  return ((data ?? []) as MessageRow[]).map(toMessage);
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

  return toMessage(data as MessageRow);
}
