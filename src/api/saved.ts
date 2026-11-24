// Сохранённые сообщения — личные копии человека: только его, не чат и не
// публичный контент. Копия — снимок того, что человек видел при сохранении;
// правки и удаление оригинала её не меняют. Автор — глазами владельца сейчас,
// название источника — живое, из чата (см. `fetchSourceChats`).

import { requestClient } from '@/api/requestClient';
import {
  chatsSelect,
  fetchChatPeople,
  getCurrentUserId,
  toSummary,
  type ChatSummary,
  type MessageAttachment,
  type MessageKind,
} from '@/api/chats';
import type { PreviewAttachment } from '@/api/messagePreview';
import { toMessageKind } from '@/api/messageRows';
import { opaqueFlag } from '@/api/opaquePeople';

export const SAVED_PAGE_SIZE = 30;
const SOURCE_CHATS_BATCH = 100;

export type SavedTag = {
  id: string;
  name: string;
  /** Номер цвета палитры тегов (`SavedTagColors`), по кругу. */
  color: number;
  usesCount: number;
};

/** Откуда сохранено, на момент сохранения: канал, свой чат, чужой; `note` — своя заметка. */
export type SavedCategory = 'channel' | 'member' | 'visitor' | 'note';

/** Копия сообщения, копия комментария или своя заметка. */
export type SavedSourceType = 'message' | 'comment' | 'note';

/**
 * Цитата ответа заметки — запись «Сохранённых» как она есть сейчас;
 * `savedId: null` — её удалили: заглушка «Запись удалена».
 */
export type SavedQuote =
  | { savedId: null }
  | {
      savedId: string;
      seq: number;
      sourceType: SavedSourceType;
      sourceChatId: string | null;
      category: SavedCategory;
      kind: MessageKind;
      text: string | null;
      /** Файлы для превью: вид, миниатюра, длительность. */
      attachments: PreviewAttachment[];
    };

export type SavedMessage = {
  id: string;
  /** Порядок и курсор страниц. */
  seq: number;
  savedAt: string;
  sourceType: SavedSourceType;
  category: SavedCategory;
  /** Чат оригинала (у комментария к попу — чат постов канала); `null` — удалён. */
  sourceChatId: string | null;
  sourceMessageId: string | null;
  sourceCommentId: string | null;
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
  /** Закреплено в «Сохранённых»; `null` — нет. Порядок закрепов — по этому времени. */
  pinnedAt: string | null;
  attachments: MessageAttachment[];
  tagIds: string[];
  /** Заметку правили. У копий — никогда: копия не меняется. */
  edited: boolean;
  /** Цитаты ответа заметки по порядку; у копий — пусто. */
  replies: SavedQuote[];
  /** Название попа из снимка — по нему тоже ищет поиск. */
  popTitle?: string | null;
};

/** Страница «Все», новыми вперёд. `nextCursor` — к более старым. */
export type SavedPage = {
  items: SavedMessage[];
  nextCursor: number | null;
};

/** Где страница начинается: самые новые или старше записи. */
export type SavedPageParam = { before: number | null };

/** Вид записи для фильтра «Тип сообщения»; правило — у базы (`saved_type`). */
export type SavedTypeFilter = 'voice' | 'pop' | 'text_media';

/**
 * Фильтр списков «Сохранённых» на сервере: внутри группы — любой из, между
 * группами — «и». Даты — моменты: `[from, to)`, границы дней считает
 * клиент в поясе устройства. `q` — поиск по тексту и названию попа.
 * Пустая группа — без условия.
 */
export type SavedFilterInput = {
  tags?: string[];
  categories?: SavedCategory[];
  types?: SavedTypeFilter[];
  from?: string;
  to?: string;
  q?: string;
};

/** Курсор «Посмотреть позже» — последняя строка прошлой страницы. */
export type WatchLaterCursor = { done: boolean; at: string; seq: number };

export type WatchLaterPage = { items: SavedMessage[]; nextCursor: WatchLaterCursor | null };

/** Что делает пункт «Посмотреть позже»: добавить, отметить, снять отметку, убрать из вкладки. */
export type WatchLaterState = 'later' | 'done' | 'undone' | 'off';

/** Закреп для полосы под переключателем. */
export type SavedPin = {
  id: string;
  seq: number;
  kind: MessageKind;
  text: string | null;
  /** Фото или постер видео первого вложения; путь в бакете. */
  thumbnailUrl: string | null;
};

/** Можно ли переслать запись: оригинал жив и виден мне сейчас. */
export type SavedForwardable =
  | {
      savedId: string;
      live: true;
      chatId: string;
      messageId: string | null;
      commentId: string | null;
    }
  | { savedId: string; live: false };

/** Что ставится каждой сохраняемой копии. */
export type SaveOptions = { tagIds: string[]; watchLater: boolean };

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
  pop_title?: string | null;
};

function popTitleOf(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  return (value as AttachmentJson[]).find((item) => item.pop_title)?.pop_title ?? null;
}

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
  pinned_at: string | null;
  attachments: unknown;
  tag_ids: string[] | null;
  edited?: boolean | null;
  replies?: unknown;
};

function toCategory(value: string | null | undefined): SavedCategory {
  return value === 'channel' || value === 'member' || value === 'note' ? value : 'visitor';
}

function toSourceType(value: string | null | undefined): SavedSourceType {
  return value === 'comment' || value === 'note' ? value : 'message';
}

type QuoteJson = {
  saved_id?: string | null;
  seq?: number | null;
  source_type?: string | null;
  source_category?: string | null;
  source_chat_id?: string | null;
  kind?: string | null;
  text?: string | null;
  attachments?: PreviewAttachment[] | null;
};

function toQuotes(value: unknown): SavedQuote[] {
  if (!Array.isArray(value)) return [];

  return (value as QuoteJson[]).map((item): SavedQuote =>
    item.saved_id
      ? {
          savedId: item.saved_id,
          seq: item.seq ?? 0,
          sourceType: toSourceType(item.source_type),
          sourceChatId: item.source_chat_id ?? null,
          category: toCategory(item.source_category),
          kind: toMessageKind(item.kind ?? 'text'),
          text: item.text ?? null,
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
        }
      : { savedId: null },
  );
}

export function toSavedMessage(row: SavedRow): SavedMessage {
  return {
    id: row.id,
    seq: row.seq,
    savedAt: row.created_at,
    sourceType: toSourceType(row.source_type),
    category: toCategory(row.source_category),
    sourceChatId: row.source_chat_id ?? null,
    sourceMessageId: row.source_message_id ?? null,
    sourceCommentId: row.source_comment_id ?? null,
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
    pinnedAt: row.pinned_at ?? null,
    attachments: toAttachments(row.attachments),
    tagIds: row.tag_ids ?? [],
    edited: row.edited ?? false,
    replies: toQuotes(row.replies),
    popTitle: popTitleOf(row.attachments),
  };
}

/**
 * Страница «Все», новыми вперёд, с догрузкой старше `before`.
 */
export async function listSavedMessages(
  param: SavedPageParam,
  limit = SAVED_PAGE_SIZE,
  filter: SavedFilterInput | null = null,
  signal?: AbortSignal,
  api = requestClient(),
): Promise<SavedPage> {
  let request = api.rpc('list_saved_messages', {
    p_before_seq: param.before ?? undefined,
    p_limit: limit,
    p_filter: filter ?? undefined,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  const items = (data ?? []).map((row) => toSavedMessage(row));
  const full = items.length === limit;
  const last = items[items.length - 1];

  return { items, nextCursor: full && last ? last.seq : null };
}

function watchCursorOf(item: SavedMessage): WatchLaterCursor | null {
  const at = item.watchDoneAt ?? item.watchLaterAt;

  return at ? { done: item.watchDoneAt !== null, at, seq: item.seq } : null;
}

/**
 * Страница «Посмотреть позже»: активные новыми вперёд, затем выполненные —
 * последнее отмеченное первым.
 */
export async function listWatchLater(
  cursor: WatchLaterCursor | null,
  filter: SavedFilterInput | null = null,
  api = requestClient(),
): Promise<WatchLaterPage> {
  const { data, error } = await api.rpc('list_saved_watch_later', {
    p_after_done: cursor?.done,
    p_after_at: cursor?.at,
    p_limit: SAVED_PAGE_SIZE,
    p_filter: filter ?? undefined,
  });

  if (error) throw error;

  const items = (data ?? []).map((row) => toSavedMessage(row));
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: items.length === SAVED_PAGE_SIZE && last ? watchCursorOf(last) : null,
  };
}

/**
 * Сохранить сообщения, как их видно в `sourceChatId` (у облачка островка —
 * чат, где стоит островок), каждое отдельной копией, в порядке на экране.
 */
export async function saveMessages(
  sourceChatId: string,
  messageIds: string[],
  options: SaveOptions,
  api = requestClient(),
): Promise<string[]> {
  const { data, error } = await api.rpc('save_messages', {
    p_source_chat: sourceChatId,
    p_message_ids: messageIds,
    p_tag_ids: options.tagIds,
    p_watch_later: options.watchLater,
  });

  if (error) throw error;

  return data ?? [];
}

/** Сохранить комментарии — к сообщению или к попу — каждый отдельной копией. */
export async function saveComments(commentIds: string[], options: SaveOptions, api = requestClient()): Promise<string[]> {
  const { data, error } = await api.rpc('save_comments', {
    p_comment_ids: commentIds,
    p_tag_ids: options.tagIds,
    p_watch_later: options.watchLater,
  });

  if (error) throw error;

  return data ?? [];
}

/** Свои теги: самые используемые первыми, при равенстве — новые. */
export async function listSavedTags(api = requestClient()): Promise<SavedTag[]> {
  const { data, error } = await api
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
export async function createSavedTag(name: string, api = requestClient()): Promise<SavedTag> {
  const { data, error } = await api.rpc('create_saved_tag', { p_name: name });

  if (error) throw error;

  const row = data?.[0];

  if (!row) throw new Error('create_saved_tag returned nothing');

  return { id: row.id, name: row.name, color: row.color, usesCount: row.uses_count };
}

/** Сколько не выполнено в «Посмотреть позже». */
export async function getSavedSummary(api = requestClient()): Promise<{ watchLaterPending: number }> {
  const { data, error } = await api.rpc('saved_summary');

  if (error) throw error;

  return { watchLaterPending: data?.[0]?.watch_later_pending ?? 0 };
}

/**
 * Чаты-источники сохранённого — живые, как их называет «Чаты». Удалённого или
 * недоступного чата в ответе нет.
 */
export async function fetchSourceChats(chatIds: string[], api = requestClient()): Promise<Map<string, ChatSummary>> {
  const byId = new Map<string, ChatSummary>();

  if (chatIds.length === 0) return byId;

  const userId = await getCurrentUserId(api);
  // Фильтр едет в адресе запроса: сотни id разом его переполнили бы.
  const batches: string[][] = [];

  for (let start = 0; start < chatIds.length; start += SOURCE_CHATS_BATCH) {
    batches.push(chatIds.slice(start, start + SOURCE_CHATS_BATCH));
  }

  const results = await Promise.all(
    batches.map((ids) => chatsSelect(api).in('id', ids).is('deleted_at', null)),
  );
  const failed = results.find((result) => result.error);

  if (failed?.error) throw failed.error;

  const chats = results.flatMap((result) => result.data ?? []);
  const people = await fetchChatPeople(chats.map((chat) => chat.id), api);

  for (const chat of chats) {
    byId.set(chat.id, toSummary(chat, people.get(chat.id) ?? { members: [], waiting: [] }, userId));
  }

  return byId;
}

/** Поставить или снять тег у записи. */
export async function setSavedTag(savedId: string, tagId: string, on: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('set_saved_tag', {
    p_saved: savedId,
    p_tag: tagId,
    p_on: on,
  });

  if (error) throw error;
}

export async function setSavedWatchLater(
  savedIds: string[],
  state: WatchLaterState,
  api = requestClient(),
): Promise<void> {
  const { error } = await api.rpc('set_saved_watch_later', {
    p_ids: savedIds,
    p_state: state,
  });

  if (error) throw error;
}

/** «Вернуть» после свайпа: прежние время добавления и отметка. */
export async function restoreSavedWatchLater(
  savedId: string,
  watchLaterAt: string,
  watchDoneAt: string | null,
  api = requestClient(),
): Promise<void> {
  const { error } = await api.rpc('restore_saved_watch_later', {
    p_saved: savedId,
    p_later_at: watchLaterAt,
    p_done_at: watchDoneAt ?? undefined,
  });

  if (error) throw error;
}

export async function setSavedPinned(savedIds: string[], pinned: boolean, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('set_saved_pinned', { p_ids: savedIds, p_pinned: pinned });

  if (error) throw error;
}

/** Удаление из сохранённого — физическое: копия, теги, отметка и закреп. */
export async function deleteSavedMessages(savedIds: string[], api = requestClient()): Promise<void> {
  const { error } = await api.rpc('delete_saved_messages', { p_ids: savedIds });

  if (error) throw error;
}

/** Закрепы по времени закрепления: от первого к последнему; под фильтром — только подходящие. */
export async function listSavedPins(filter: SavedFilterInput | null = null, api = requestClient()): Promise<SavedPin[]> {
  const { data, error } = await api.rpc('list_saved_pins', { p_filter: filter ?? undefined });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    seq: row.seq,
    kind: toMessageKind(row.kind),
    text: row.text ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
  }));
}

/** Что из выбранного можно переслать и откуда — решает база, по порядку `seq`. */
export async function listSavedForwardable(savedIds: string[], api = requestClient()): Promise<SavedForwardable[]> {
  const { data, error } = await api.rpc('saved_forwardable', { p_ids: savedIds });

  if (error) throw error;

  return (data ?? []).map((row): SavedForwardable =>
    row.live && row.chat_id
      ? {
          savedId: row.saved_id,
          live: true,
          chatId: row.chat_id,
          messageId: row.message_id ?? null,
          commentId: row.comment_id ?? null,
        }
      : { savedId: row.saved_id, live: false },
  );
}

/** Файл заметки — уже очищенный, свой: путь в `chat-media` и что о нём знает вложение. */
export type SavedNoteFile = {
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
};

export type SavedNoteInput = {
  /** Ключ повтора: та же отправка не создаёт вторую заметку. */
  clientId: string;
  text: string | null;
  files: SavedNoteFile[];
  /** Цитаты — свои записи, по порядку. */
  replyTo: string[];
  /** Голосовое — один файл без подписи; иначе вид по файлам. */
  kind: 'post' | 'voice';
};

/**
 * Новая заметка; отвечает её id. Строку читает `getSavedMessage` отдельно:
 * заметка уже записана, даже если чтение потом не удалось.
 */
export async function sendSavedNote(input: SavedNoteInput, api = requestClient()): Promise<string> {
  const { data: id, error } = await api.rpc('send_saved_note', {
    p_client_id: input.clientId,
    p_text: input.text ?? undefined,
    p_media: input.files.map((file) => ({
      url: file.url,
      poster_url: file.posterUrl,
      mime_type: file.mimeType,
      width: file.width,
      height: file.height,
      duration_ms: file.durationMs === null ? null : Math.round(file.durationMs),
      waveform: file.waveform,
    })),
    p_reply_to: input.replyTo,
    p_kind: input.kind === 'voice' ? 'voice' : undefined,
  });

  if (error) throw error;
  if (typeof id !== 'string') throw new Error('send_saved_note returned nothing');

  return id;
}

/**
 * Неотправленную заметку убрали, а ответ сервера на неё не дошёл: она могла
 * создаться. Удаляет её по ключу повтора; нет такой — ничего.
 */
export async function deleteSavedNoteByClient(clientId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('delete_saved_note_by_client', { p_client_id: clientId });

  if (error) throw error;
}

/**
 * Одна запись по id — как её отдают страницы «Все». С фильтром — `null`,
 * если она под него не подходит.
 */
export async function getSavedMessage(
  id: string,
  filter: SavedFilterInput | null = null,
  api = requestClient(),
): Promise<SavedMessage | null> {
  // Окно из одной записи: до её номера включительно — её не знаем, поэтому
  // через страницу «Посмотреть позже» нельзя; берём по seq из таблицы.
  const { data: row, error } = await api
    .from('saved_messages')
    .select('seq')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  const page = await listSavedMessages({ before: row.seq + 1 }, 1, filter, undefined, api);

  return page.items.find((item) => item.id === id) ?? null;
}

/** Сколько записей подходит под фильтр (с `q` — совпадений поиска), до потолка. */
export async function countSavedMessages(
  filter: SavedFilterInput,
  signal?: AbortSignal,
  api = requestClient(),
): Promise<number> {
  let request = api.rpc('count_saved_messages', { p_filter: filter });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  return data ?? 0;
}

/**
 * Правка своей заметки: текст и какие вложения оставить, по порядку.
 * Копию сообщения база не правит.
 */
export async function editSavedNote(savedId: string, text: string, keep: string[], api = requestClient()): Promise<void> {
  const { error } = await api.rpc('edit_saved_note', {
    p_saved: savedId,
    p_text: text,
    p_keep: keep,
  });

  if (error) throw error;
}

/** Копии заметок — новыми заметками с теми же файлами («★ Сохранённые» в листе пересылки). */
export async function copySavedNotes(savedIds: string[], options: SaveOptions, api = requestClient()): Promise<string[]> {
  const { data, error } = await api.rpc('copy_saved_notes', {
    p_ids: savedIds,
    p_tag_ids: options.tagIds,
    p_watch_later: options.watchLater,
  });

  if (error) throw error;

  return data ?? [];
}
