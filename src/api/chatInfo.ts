// Данные страницы информации о чате: сводка, вкладки медиа, голосовых и
// общих групп, «был(а) в …». Все выборки идут через RLS (функции
// `security invoker`): удалённое и скрытое политиками сюда не попадает.

import { supabase } from '@/api/supabase';

export const CHAT_INFO_PAGE_SIZE = 30;

/** Курсор постраничных выборок: время и id последней строки прошлой страницы. */
export type InfoCursor = { at: string; id: string };

/**
 * Курсор вкладок с сообщениями — номер самого старого сообщения прошлой
 * страницы: время сообщений бывает скрыто от смотрящего.
 */
export type MessageCursor = number;

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
  /** Номер сообщения — по нему «Показать в чате» догружает историю. */
  seq: number;
  /** `null` — время чата скрыто от меня. */
  createdAt: string | null;
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Автор скрыл медиа: пути и постера нет, клетка — «скрыто автором». */
  hidden: boolean;
};

export type ChatMediaPage = { items: ChatMediaItem[]; next: MessageCursor | null };

/**
 * Страница медиа чата, свежие сверху. Страница режется по сообщениям, а не по
 * вложениям: альбом не рвётся. Курсор — последнее сообщение страницы.
 */
export async function listChatMedia(
  chatId: string,
  cursor: MessageCursor | null,
): Promise<ChatMediaPage> {
  const { data, error } = await supabase.rpc('list_chat_media', {
    target_chat: chatId,
    before_seq: cursor ?? undefined,
    page_size: CHAT_INFO_PAGE_SIZE,
  });

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.map((row) => ({
    id: row.attachment_id,
    messageId: row.message_id,
    seq: row.seq,
    // Колонки результата rpc генератор типов не размечает как nullable.
    createdAt: row.created_at ?? null,
    url: row.url ?? '',
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    hidden: row.media_hidden === true,
  }));
  const messages = new Set(items.map((item) => item.messageId)).size;
  const last = items[items.length - 1];

  return {
    items,
    next:
      last && messages >= CHAT_INFO_PAGE_SIZE ? last.seq : null,
  };
}

/** Строка вкладки «Голосовые»: голосовое или кружок. */
export type ChatVoiceItem = {
  messageId: string;
  kind: 'voice' | 'video_note';
  seq: number;
  /** `null` — время чата скрыто от меня. */
  createdAt: string | null;
  authorId: string | null;
  /** null — аккаунт автора удалён. */
  authorName: string | null;
  attachmentId: string;
  url: string;
  posterUrl: string | null;
  mimeType: string | null;
  durationMs: number;
  waveform: number[] | null;
  /** Автор скрыл медиа: пути и волны нет, только длительность. */
  hidden: boolean;
};

export type ChatVoicePage = { items: ChatVoiceItem[]; next: MessageCursor | null };

export async function listChatVoices(
  chatId: string,
  cursor: MessageCursor | null,
): Promise<ChatVoicePage> {
  const { data, error } = await supabase.rpc('list_chat_voices', {
    target_chat: chatId,
    before_seq: cursor ?? undefined,
    page_size: CHAT_INFO_PAGE_SIZE,
  });

  if (error) throw error;

  const items: ChatVoiceItem[] = (data ?? []).map((row) => ({
    messageId: row.message_id,
    kind: row.kind === 'video_note' ? 'video_note' : 'voice',
    seq: row.seq,
    createdAt: row.created_at ?? null,
    authorId: row.author_id,
    authorName: row.author_name,
    attachmentId: row.attachment_id,
    url: row.url ?? '',
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    durationMs: row.duration_ms ?? 0,
    waveform: row.waveform,
    hidden: row.media_hidden === true,
  }));
  const last = items[items.length - 1];

  return {
    items,
    next:
      last && items.length >= CHAT_INFO_PAGE_SIZE ? last.seq : null,
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
 * «В сети» и «был(а) в …» глазами смотрящего. Общего Presence-канала нет:
 * внутри него не отфильтровать по зрителю, а авторизация Realtime не
 * отзывается при смене настройки. Статус отдаёт база с проверкой настройки
 * «Кто видит, что я в сети» (миграция `20261030130000_privacy_activity_status.sql`):
 * закрытый, удалённый и ни разу не заходивший приходят одинаково.
 */
export type ActivityStatus = {
  online: boolean;
  /** `null` — неизвестно: скрыто настройкой или человек не заходил. */
  lastSeenAt: string | null;
};

/** Сколько id в одном запросе «был(а)» — столько база принимает за раз. */
const LAST_SEEN_CHUNK = 200;

/** Статусы людей: id → «в сети» и когда был. Удалённых база не отдаёт. */
export async function getLastSeen(userIds: string[]): Promise<Map<string, ActivityStatus>> {
  const seen = new Map<string, ActivityStatus>();
  const chunks: string[][] = [];

  for (let at = 0; at < userIds.length; at += LAST_SEEN_CHUNK) {
    chunks.push(userIds.slice(at, at + LAST_SEEN_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((ids) => supabase.rpc('activity_statuses', { user_ids: ids })),
  );

  for (const { data, error } of results) {
    if (error) throw error;

    for (const row of data ?? []) {
      // Колонки результата rpc генератор типов не размечает как nullable.
      seen.set(row.user_id, { online: row.online === true, lastSeenAt: row.last_seen_at ?? null });
    }
  }

  return seen;
}

/**
 * Отметить себя: на переднем плане — «в сети» ещё две минуты (подтверждать
 * раз в минуту), уход в фон — «был(а) сейчас». Пишет только база по моему
 * токену.
 */
export async function markSeen(online: boolean): Promise<void> {
  const { error } = await supabase.rpc('mark_seen', { online });

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
