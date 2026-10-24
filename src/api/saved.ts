// Сохранённые сообщения — личные копии человека: только его, не чат и не
// публичный контент. Копия — снимок того, что человек видел при сохранении;
// правки и удаление оригинала её не меняют. Автор — глазами владельца сейчас,
// название источника — живое, из чата (см. `fetchSourceChats`).

import {
  chatsSelect,
  fetchChatPeople,
  getCurrentUserId,
  toSummary,
  type ChatSummary,
  type MessageAttachment,
  type MessageKind,
} from '@/api/chats';
import { toMessageKind } from '@/api/messageRows';
import { opaqueFlag } from '@/api/opaquePeople';
import { supabase } from '@/api/supabase';

export const SAVED_PAGE_SIZE = 30;
const SOURCE_CHATS_BATCH = 100;

export type SavedTag = {
  id: string;
  name: string;
  /** Номер цвета палитры тегов (`SavedTagColors`), по кругу. */
  color: number;
  usesCount: number;
};

/** Откуда сохранено, на момент сохранения: канал, свой чат, чужой. */
export type SavedCategory = 'channel' | 'member' | 'visitor';

export type SavedMessage = {
  id: string;
  /** Порядок и курсор страниц. */
  seq: number;
  savedAt: string;
  sourceType: 'message' | 'comment';
  category: SavedCategory;
  /** Чат оригинала (у комментария к попу — чат постов канала); `null` — удалён. */
  sourceChatId: string | null;
  sourceMessageId: string | null;
  sourceCommentId: string | null;
  /** Номер сообщения (или того, под которым комментарий) — для перехода. */
  sourceSeq: number | null;
  commentMessageId: string | null;
  commentPopId: string | null;
  kind: MessageKind;
  text: string | null;
  /** Автор глазами владельца; `null` — удалён или подменён (`authorOpaque`). */
  authorId: string | null;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorOpaque: boolean;
  /** Время оригинала; `null` — было скрыто от меня при сохранении. */
  originalAt: string | null;
  watchLaterAt: string | null;
  watchDoneAt: string | null;
  attachments: MessageAttachment[];
  tagIds: string[];
};

export type SavedPage = { items: SavedMessage[]; nextCursor: number | null };

/** Что ставится каждой сохраняемой копии. */
export type SaveOptions = { tagIds: string[]; watchLater: boolean };

/** Куда ведёт тап по источнику: решает база. */
export type SavedSource =
  | {
      state: 'live';
      chatId: string;
      channelId: string | null;
      messageId: string | null;
      seq: number | null;
      commentId: string | null;
      popId: string | null;
      popChannelId: string | null;
    }
  | { state: 'original_gone'; chatId: string; channelId: string | null }
  | { state: 'chat_gone' };

type AttachmentJson = {
  id?: string;
  url?: string | null;
  poster_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  waveform?: number[] | null;
  media_hidden?: boolean | null;
  pop_id?: string | null;
  pop_channel_id?: string | null;
};

function toAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];

  return (value as AttachmentJson[]).map((item) => ({
    id: item.id ?? '',
    url: item.url ?? '',
    posterUrl: item.poster_url ?? null,
    mimeType: item.mime_type ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.duration_ms ?? null,
    waveform: item.waveform ?? null,
    popId: item.pop_id ?? null,
    popChannelId: item.pop_channel_id ?? null,
    // Удалённый при сохранении поп — без файла, как скрытое.
    popDeleted: item.pop_id ? item.media_hidden === true : undefined,
    hidden: !item.pop_id && item.media_hidden === true,
  }));
}

type SavedRow = {
  id: string;
  seq: number;
  created_at: string;
  source_type: string;
  source_category: string;
  source_chat_id: string | null;
  source_message_id: string | null;
  source_comment_id: string | null;
  source_seq: number | null;
  comment_message_id: string | null;
  comment_pop_id: string | null;
  kind: string;
  text: string | null;
  author_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  author_opaque: boolean | null;
  original_at: string | null;
  watch_later_at: string | null;
  watch_done_at: string | null;
  attachments: unknown;
  tag_ids: string[] | null;
};

function toCategory(value: string): SavedCategory {
  return value === 'channel' || value === 'member' ? value : 'visitor';
}

export function toSavedMessage(row: SavedRow): SavedMessage {
  return {
    id: row.id,
    seq: row.seq,
    savedAt: row.created_at,
    sourceType: row.source_type === 'comment' ? 'comment' : 'message',
    category: toCategory(row.source_category),
    sourceChatId: row.source_chat_id ?? null,
    sourceMessageId: row.source_message_id ?? null,
    sourceCommentId: row.source_comment_id ?? null,
    sourceSeq: row.source_seq ?? null,
    commentMessageId: row.comment_message_id ?? null,
    commentPopId: row.comment_pop_id ?? null,
    kind: toMessageKind(row.kind),
    text: row.text ?? null,
    authorId: row.author_id ?? null,
    // Подменённый при сохранении — снимок имени, id нет.
    authorName: row.author_name ?? null,
    authorAvatarUrl: row.author_avatar_url ?? null,
    authorOpaque: opaqueFlag(row.author_id, row.author_opaque),
    originalAt: row.original_at ?? null,
    watchLaterAt: row.watch_later_at ?? null,
    watchDoneAt: row.watch_done_at ?? null,
    attachments: toAttachments(row.attachments),
    tagIds: row.tag_ids ?? [],
  };
}

/** Страница сохранённого, новыми вперёд; `beforeSeq` — курсор к более старым. */
export async function listSavedMessages(beforeSeq: number | null): Promise<SavedPage> {
  const { data, error } = await supabase.rpc('list_saved_messages', {
    p_before_seq: beforeSeq ?? undefined,
    p_limit: SAVED_PAGE_SIZE,
  });

  if (error) throw error;

  const items = (data ?? []).map((row) => toSavedMessage(row));
  const last = items[items.length - 1];

  return { items, nextCursor: items.length === SAVED_PAGE_SIZE && last ? last.seq : null };
}

/**
 * Сохранить сообщения, как их видно в `sourceChatId` (у облачка островка —
 * чат, где стоит островок), каждое отдельной копией, в порядке на экране.
 */
export async function saveMessages(
  sourceChatId: string,
  messageIds: string[],
  options: SaveOptions,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('save_messages', {
    p_source_chat: sourceChatId,
    p_message_ids: messageIds,
    p_tag_ids: options.tagIds,
    p_watch_later: options.watchLater,
  });

  if (error) throw error;

  return data ?? [];
}

/** Сохранить комментарии — к сообщению или к попу — каждый отдельной копией. */
export async function saveComments(commentIds: string[], options: SaveOptions): Promise<string[]> {
  const { data, error } = await supabase.rpc('save_comments', {
    p_comment_ids: commentIds,
    p_tag_ids: options.tagIds,
    p_watch_later: options.watchLater,
  });

  if (error) throw error;

  return data ?? [];
}

/** Свои теги: самые используемые первыми, при равенстве — новые. */
export async function listSavedTags(): Promise<SavedTag[]> {
  const { data, error } = await supabase
    .from('saved_tags')
    .select('id, name, color, uses_count')
    .order('uses_count', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    usesCount: row.uses_count,
  }));
}

/** Новый тег; то же имя без учёта регистра — уже существующий. */
export async function createSavedTag(name: string): Promise<SavedTag> {
  const { data, error } = await supabase.rpc('create_saved_tag', { p_name: name });

  if (error) throw error;

  const row = data?.[0];

  if (!row) throw new Error('create_saved_tag returned nothing');

  return { id: row.id, name: row.name, color: row.color, usesCount: row.uses_count };
}

/** Сколько не выполнено в «Посмотреть позже». */
export async function getSavedSummary(): Promise<{ watchLaterPending: number }> {
  const { data, error } = await supabase.rpc('saved_summary');

  if (error) throw error;

  return { watchLaterPending: data?.[0]?.watch_later_pending ?? 0 };
}

export async function getSavedSource(savedId: string): Promise<SavedSource> {
  const { data, error } = await supabase.rpc('saved_source', { p_saved: savedId });

  if (error) throw error;

  const row = data?.[0];

  if (!row || row.state === 'chat_gone' || !row.chat_id) return { state: 'chat_gone' };

  if (row.state !== 'live') {
    return { state: 'original_gone', chatId: row.chat_id, channelId: row.channel_id ?? null };
  }

  return {
    state: 'live',
    chatId: row.chat_id,
    channelId: row.channel_id ?? null,
    messageId: row.message_id ?? null,
    seq: row.seq ?? null,
    commentId: row.comment_id ?? null,
    popId: row.pop_id ?? null,
    popChannelId: row.pop_channel_id ?? null,
  };
}

/**
 * Чаты-источники сохранённого — живые, как их называет «Чаты». Удалённого или
 * недоступного чата в ответе нет.
 */
export async function fetchSourceChats(chatIds: string[]): Promise<Map<string, ChatSummary>> {
  const byId = new Map<string, ChatSummary>();

  if (chatIds.length === 0) return byId;

  const userId = await getCurrentUserId();
  // Фильтр едет в адресе запроса: сотни id разом его переполнили бы.
  const batches: string[][] = [];

  for (let start = 0; start < chatIds.length; start += SOURCE_CHATS_BATCH) {
    batches.push(chatIds.slice(start, start + SOURCE_CHATS_BATCH));
  }

  const results = await Promise.all(
    batches.map((ids) => chatsSelect().in('id', ids).is('deleted_at', null)),
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) throw failed.error;

  const chats = results.flatMap((result) => result.data ?? []);
  const people = await fetchChatPeople(chats.map((chat) => chat.id));

  for (const chat of chats) {
    byId.set(chat.id, toSummary(chat, people.get(chat.id) ?? { members: [], waiting: [] }, userId));
  }

  return byId;
}
