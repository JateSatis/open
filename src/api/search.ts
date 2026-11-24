// Поиск в «Чатах» и в «Ленте». Вся логика сравнения — в базе (миграции
// `20261016100000_search.sql` и `20261017100000_search_feed.sql`):
// нормализация ё/е и регистра, морфология, опечатки, ранг, разбор `@` и
// суффикса `.ch` / `.di`. Здесь — только вызов
// функций и перевод строк в типы выдачи. Срок на запрос стоит в `fetch`
// клиента (`requestDeadline.ts`), `signal` отменяет устаревший запрос.

import { requestClient } from '@/api/requestClient';
import type { Pop } from '@/api/pops';
import { toReactionCounts } from '@/api/reactionCounts';

/** Чем сущность открывается: чат — перепиской, канал — экраном канала, человек — профилем. */
export type SearchEntityKind = 'direct' | 'group' | 'channel' | 'person';

/** «Чаты» — мои чаты и подписки, «Глобальный поиск» — остальное с @именем. */
export type SearchSection = 'mine' | 'global';

export type SearchEntity = {
  section: SearchSection;
  kind: SearchEntityKind;
  /** Чат — id чата, канал — id канала, человек — id профиля. */
  id: string;
  /** Чат постов у канала, сам чат у диалога и группы; у человека — null. */
  chatId: string | null;
  channelId: string | null;
  /** Собеседник моего диалога или сам найденный человек. */
  personId: string | null;
  title: string;
  /** Без `@` и суффикса: его ставит `formatUsername` по виду. */
  username: string | null;
  avatarUrl: string | null;
  /** Есть в «Чатах» подпиской, а не участием. */
  subscribed: boolean;
  subscribersCount: number | null;
};

export type SearchMessage = {
  id: string;
  chatId: string;
  chatKind: Exclude<SearchEntityKind, 'person'>;
  /** У поста канала: открывать экраном канала. */
  channelId: string | null;
  chatTitle: string;
  chatAvatarUrl: string | null;
  authorId: string | null;
  authorName: string;
  text: string;
  /** Номер сообщения — до него догружается история при переходе. */
  seq: number;
  /** `null` — время чата скрыто от меня. */
  createdAt: string | null;
  /** Найдено с опечаткой: точного совпадения по запросу нет. */
  fuzzy: boolean;
};

/** Ключ следующей страницы сообщений: номер последней строки предыдущей. */
export type SearchMessagesCursor = number;

export type SearchMessagesPage = {
  items: SearchMessage[];
  nextCursor: SearchMessagesCursor | null;
};

export { isSearchRateLimited, SEARCH_RATE_LIMIT_TEXT } from '@/api/searchLimits';

/** Сколько строк блока приходит сразу: видно 3, остальное — за «Показать ещё». */
export const SEARCH_MINE_LIMIT = 50;
export const SEARCH_GLOBAL_LIMIT = 20;
export const SEARCH_MESSAGES_PAGE_SIZE = 30;

const ENTITY_KINDS: readonly SearchEntityKind[] = ['direct', 'group', 'channel', 'person'];

function toEntityKind(value: string): SearchEntityKind | null {
  return (ENTITY_KINDS as readonly string[]).includes(value) ? (value as SearchEntityKind) : null;
}

// Генератор типов не размечает колонки результата функции как nullable,
// хотя половина из них бывает пустой у части видов. Отсюда `?? null`.

/** Оба блока сущностей, каждый уже упорядочен базой. */
export async function searchEntities(query: string, signal?: AbortSignal, api = requestClient()): Promise<SearchEntity[]> {
  let request = api.rpc('search_entities', {
    query,
    mine_limit: SEARCH_MINE_LIMIT,
    global_limit: SEARCH_GLOBAL_LIMIT,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  const entities: SearchEntity[] = [];

  for (const row of data ?? []) {
    const kind = toEntityKind(row.entity_kind);

    if (!kind) continue;

    entities.push({
      section: row.section === 'global' ? 'global' : 'mine',
      kind,
      id: row.id,
      chatId: row.chat_id ?? null,
      channelId: row.channel_id ?? null,
      personId: row.peer_id ?? null,
      title: row.title ?? '',
      username: row.username ?? null,
      avatarUrl: row.avatar_url ?? null,
      subscribed: row.subscribed === true,
      subscribersCount: row.subscribers_count ?? null,
    });
  }

  return entities;
}

/**
 * Страница сообщений и постов моих чатов и подписок, от новых к старым.
 * Чужие чаты база не отдаёт: поиск идёт только по `searchable_chat_ids`.
 */
export async function searchMessages(
  query: string,
  cursor: SearchMessagesCursor | null,
  signal?: AbortSignal,
  api = requestClient(),
): Promise<SearchMessagesPage> {
  let request = api.rpc('search_messages', {
    query,
    before_seq: cursor ?? undefined,
    page_size: SEARCH_MESSAGES_PAGE_SIZE,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  const items: SearchMessage[] = (data ?? []).map((row) => {
    const kind = toEntityKind(row.chat_kind);

    return {
      id: row.message_id,
      chatId: row.chat_id,
      chatKind: kind === 'group' || kind === 'channel' ? kind : 'direct',
      channelId: row.channel_id ?? null,
      chatTitle: row.chat_title ?? '',
      chatAvatarUrl: row.chat_avatar_url ?? null,
      authorId: row.author_id ?? null,
      authorName: row.author_name ?? 'Без имени',
      text: row.text ?? '',
      seq: row.seq,
      createdAt: row.created_at ?? null,
      fuzzy: row.fuzzy === true,
    };
  });
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: items.length === SEARCH_MESSAGES_PAGE_SIZE && last ? last.seq : null,
  };
}

/** Что из сохранённых «Недавних» ещё можно показать — по ответу сервера. */
export type RecentRecheck = {
  /**
   * Люди, которые по-прежнему пускают меня в поиск, — какими они видны мне
   * сейчас: скрывший имя — псевдонимом, без username и фото.
   */
  people: Map<string, { title: string; username: string | null; avatarUrl: string | null }>;
  /** Живые и находимые мне сообщения: id → время, автор и чат глазами меня сейчас. */
  messages: Map<string, { createdAt: string | null; authorName: string; chatTitle: string | null }>;
  /**
   * Мои чаты и подписки: id чата → название и лицо глазами меня сейчас (у
   * лички это собеседник — он мог скрыть имя или фото).
   */
  chats: Map<string, { title: string; username: string | null; avatarUrl: string | null }>;
};

/**
 * Перепроверить «Недавние»: они лежат на телефоне, и без этого история
 * воскрешала бы человека, который с тех пор закрыл от меня поиск, или время
 * сообщения, которое теперь скрыто.
 */
export async function recheckRecentSearches(
  personIds: string[],
  messageIds: string[],
  chatIds: string[] = [],
  api = requestClient(),
): Promise<RecentRecheck> {
  const result: RecentRecheck = { people: new Map(), messages: new Map(), chats: new Map() };

  if (personIds.length === 0 && messageIds.length === 0 && chatIds.length === 0) return result;

  const { data, error } = await api.rpc('recheck_recent_searches', {
    person_ids: personIds,
    message_ids: messageIds,
    chat_ids: chatIds,
  });

  if (error) throw error;

  // Колонки результата rpc генератор типов не размечает как nullable.
  for (const row of data ?? []) {
    if (row.kind === 'person') {
      result.people.set(row.id, {
        title: row.display_name ?? 'Без имени',
        username: row.username ?? null,
        avatarUrl: row.avatar_url ?? null,
      });
    } else if (row.kind === 'chat') {
      result.chats.set(row.id, {
        title: row.display_name ?? 'Чат',
        username: row.username ?? null,
        avatarUrl: row.avatar_url ?? null,
      });
    } else {
      result.messages.set(row.id, {
        createdAt: row.created_at ?? null,
        authorName: row.display_name ?? 'Без имени',
        chatTitle: row.chat_title ?? null,
      });
    }
  }

  return result;
}

// =============================================================================
// Поиск в «Ленте»: каналы и попсы
// =============================================================================

/** Канал в выдаче «Ленты»: все каналы одним списком. */
export type SearchChannel = {
  id: string;
  postsChatId: string;
  title: string;
  /** Без `@` и суффикса. */
  username: string | null;
  avatarUrl: string | null;
  subscribersCount: number;
  /** Я подписан. */
  subscribed: boolean;
  /** Я публикую в нём. */
  mine: boolean;
};

/**
 * Поп выдачи: всё, что нужно плитке и просмотру, без дозапросов, плюс место в
 * выдаче — курсор следующей страницы.
 */
export type SearchPop = Pop & {
  channelTitle: string;
  channelAvatarUrl: string | null;
  /**
   * Ранг совпадения: уровень × 2, у своего текста попа +1 — свой текст 3, 5,
   * 7, 9, только канал 2, 4, 6, 8.
   */
  rank: number;
  /** Скор популярности и свежести на момент `scoredAt`. */
  score: number;
  /** Момент отсчёта скора — общий для всех страниц одного запроса. */
  scoredAt: string;
};

/** Ключ следующей страницы попсов: последняя строка предыдущей и момент отсчёта. */
export type SearchPopsCursor = { rank: number; score: number; id: string; scoredAt: string };

export const SEARCH_CHANNELS_LIMIT = 50;
export const SEARCH_POPS_PAGE_SIZE = 30;

/** Каналы по названию и @имени, упорядочены базой. */
export async function searchChannels(
  query: string,
  signal?: AbortSignal,
  api = requestClient(),
): Promise<SearchChannel[]> {
  let request = api.rpc('search_channels', { query, max_count: SEARCH_CHANNELS_LIMIT });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    postsChatId: row.posts_chat_id,
    title: row.title ?? '',
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    subscribersCount: row.subscribers_count ?? 0,
    subscribed: row.subscribed === true,
    mine: row.mine === true,
  }));
}

/**
 * Страница попсов по запросу: по рангу совпадения, внутри — по скору.
 * Первая страница — без курсора; следующие несут курсор с моментом отсчёта
 * первой, чтобы скор не уплыл между страницами.
 */
export async function searchPops(
  query: string,
  cursor: SearchPopsCursor | null,
  signal?: AbortSignal,
  api = requestClient(),
): Promise<SearchPop[]> {
  let request = api.rpc('search_pops', {
    query,
    as_of: cursor?.scoredAt,
    after_rank: cursor?.rank,
    after_score: cursor?.score,
    after_id: cursor?.id,
    page_size: SEARCH_POPS_PAGE_SIZE,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id ?? null,
    title: row.title ?? null,
    caption: row.caption ?? null,
    url: row.url,
    posterUrl: row.poster_url,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    reactions: { counts: toReactionCounts(row.reactions), mine: row.my_reaction ?? null },
    viewsCount: row.views_count,
    commentsCount: row.comments_count,
    channelTitle: row.channel_title ?? '',
    channelAvatarUrl: row.channel_avatar_url ?? null,
    rank: row.rank,
    score: row.score,
    scoredAt: row.scored_at,
  }));
}

/** Курсор после этой страницы; `null` — страница неполная, дальше пусто. */
export function nextSearchPopsCursor(page: SearchPop[]): SearchPopsCursor | null {
  const last = page[page.length - 1];

  return page.length === SEARCH_POPS_PAGE_SIZE && last
    ? { rank: last.rank, score: last.score, id: last.id, scoredAt: last.scoredAt }
    : null;
}
