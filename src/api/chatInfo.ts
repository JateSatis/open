// Данные страницы информации о чате: сводка, вкладки медиа, голосовых и
// общих групп, «был(а) в …». Все выборки идут через RLS (функции
// `security invoker`): удалённое и скрытое политиками сюда не попадает.

import { supabase } from '@/api/supabase';

export const CHAT_INFO_PAGE_SIZE = 30;

/** Курсор постраничных выборок: время и id последней строки прошлой страницы. */
export type InfoCursor = { at: string; id: string };

export type ChatInfoSummary = {
  /** Создатель группы — «владелец»; у диалога null. */
  ownerId: string | null;
  photos: number;
  videos: number;
  voices: number;
  /** Общие группы со мной — только у участника личного диалога. */
  commonGroups: number;
};

export async function getChatInfoSummary(chatId: string): Promise<ChatInfoSummary> {
  const { data, error } = await supabase.rpc('chat_info_summary', { target_chat: chatId });

  if (error) throw error;

  const row = data?.[0];

  return {
    ownerId: row?.owner_id ?? null,
    photos: row?.photos ?? 0,
    videos: row?.videos ?? 0,
    voices: row?.voices ?? 0,
    commonGroups: row?.common_groups ?? 0,
  };
}

/** Одна клетка вкладки «Медиа»: вложение фото или видео. */
export type ChatMediaItem = {
  id: string;
  messageId: string;
  createdAt: string;
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type ChatMediaPage = { items: ChatMediaItem[]; next: InfoCursor | null };

/**
 * Страница медиа чата, свежие сверху. Страница режется по сообщениям, а не по
 * вложениям: альбом не рвётся. Курсор — последнее сообщение страницы.
 */
export async function listChatMedia(
  chatId: string,
  cursor: InfoCursor | null,
): Promise<ChatMediaPage> {
  const { data, error } = await supabase.rpc('list_chat_media', {
    target_chat: chatId,
    before_at: cursor?.at,
    before_id: cursor?.id,
    page_size: CHAT_INFO_PAGE_SIZE,
  });

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.map((row) => ({
    id: row.attachment_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    url: row.url,
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
  }));
  const messages = new Set(items.map((item) => item.messageId)).size;
  const last = items[items.length - 1];

  return {
    items,
    next:
      last && messages >= CHAT_INFO_PAGE_SIZE ? { at: last.createdAt, id: last.messageId } : null,
  };
}

/** Строка вкладки «Голосовые»: голосовое или кружок. */
export type ChatVoiceItem = {
  messageId: string;
  kind: 'voice' | 'video_note';
  createdAt: string;
  authorId: string | null;
  /** null — аккаунт автора удалён. */
  authorName: string | null;
  attachmentId: string;
  url: string;
  posterUrl: string | null;
  mimeType: string | null;
  durationMs: number;
  waveform: number[] | null;
};

export type ChatVoicePage = { items: ChatVoiceItem[]; next: InfoCursor | null };

export async function listChatVoices(
  chatId: string,
  cursor: InfoCursor | null,
): Promise<ChatVoicePage> {
  const { data, error } = await supabase.rpc('list_chat_voices', {
    target_chat: chatId,
    before_at: cursor?.at,
    before_id: cursor?.id,
    page_size: CHAT_INFO_PAGE_SIZE,
  });

  if (error) throw error;

  const items: ChatVoiceItem[] = (data ?? []).map((row) => ({
    messageId: row.message_id,
    kind: row.kind === 'video_note' ? 'video_note' : 'voice',
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.author_name,
    attachmentId: row.attachment_id,
    url: row.url,
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    durationMs: row.duration_ms ?? 0,
    waveform: row.waveform,
  }));
  const last = items[items.length - 1];

  return {
    items,
    next:
      last && items.length >= CHAT_INFO_PAGE_SIZE
        ? { at: last.createdAt, id: last.messageId }
        : null,
  };
}

export type CommonGroup = {
  id: string;
  title: string | null;
  avatarUrl: string | null;
  membersCount: number;
  createdAt: string;
};

export type CommonGroupsPage = { items: CommonGroup[]; next: InfoCursor | null };

/** Группы, где состоим и я, и `otherUserId`, — свежие по созданию сверху. */
export async function listCommonGroups(
  otherUserId: string,
  cursor: InfoCursor | null,
): Promise<CommonGroupsPage> {
  const { data, error } = await supabase.rpc('list_common_groups', {
    other_user: otherUserId,
    before_at: cursor?.at,
    before_id: cursor?.id,
    page_size: CHAT_INFO_PAGE_SIZE,
  });

  if (error) throw error;

  const items = (data ?? []).map((row) => ({
    id: row.chat_id,
    title: row.title,
    avatarUrl: row.avatar_url,
    membersCount: row.members_count,
    createdAt: row.created_at,
  }));
  const last = items[items.length - 1];

  return {
    items,
    next: last && items.length >= CHAT_INFO_PAGE_SIZE ? { at: last.createdAt, id: last.id } : null,
  };
}

/**
 * Сколько id в одном запросе «был(а)»: id идут в адрес запроса, и у большой
 * группы он упёрся бы в предел длины.
 */
const LAST_SEEN_CHUNK = 100;

/** Когда люди были в приложении в последний раз: id → время или null («давно»). */
export async function getLastSeen(userIds: string[]): Promise<Map<string, string | null>> {
  const seen = new Map<string, string | null>();
  const chunks: string[][] = [];

  for (let at = 0; at < userIds.length; at += LAST_SEEN_CHUNK) {
    chunks.push(userIds.slice(at, at + LAST_SEEN_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((ids) => supabase.from('profiles').select('id, last_seen_at').in('id', ids)),
  );

  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) seen.set(row.id, row.last_seen_at);
  }

  return seen;
}

/**
 * Отметить себя «был(а) сейчас». Пишет только база по моему токену; чаще раза
 * в 30 с строку не трогает.
 */
export async function markSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_seen');

  if (error) throw error;
}

/**
 * Сменить или убрать название группы. Право — у создателя; остальным база
 * отказывает.
 */
export async function setChatTitle(chatId: string, title: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_chat_title', {
    target_chat: chatId,
    // Функция принимает null, но генератор типов не размечает скалярные
    // аргументы rpc как nullable — отсюда приведение.
    new_title: title as string,
  });

  if (error) throw error;
}
