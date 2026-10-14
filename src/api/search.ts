// Поиск в «Чатах». Вся логика сравнения — в базе (миграция
// `20261016100000_search.sql`): нормализация ё/е и регистра, морфология,
// опечатки, ранг, разбор `@` и суффикса `.ch` / `.di`. Здесь — только вызов
// функций и перевод строк в типы выдачи. Срок на запрос стоит в `fetch`
// клиента (`requestDeadline.ts`), `signal` отменяет устаревший запрос.

import { supabase } from '@/api/supabase';

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
  createdAt: string;
  /** Найдено с опечаткой: точного совпадения по запросу нет. */
  fuzzy: boolean;
};

/** Ключ следующей страницы сообщений: последняя строка предыдущей. */
export type SearchMessagesCursor = { createdAt: string; id: string };

export type SearchMessagesPage = {
  items: SearchMessage[];
  nextCursor: SearchMessagesCursor | null;
};

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
export async function searchEntities(
  query: string,
  signal?: AbortSignal,
): Promise<SearchEntity[]> {
  let request = supabase.rpc('search_entities', {
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
): Promise<SearchMessagesPage> {
  let request = supabase.rpc('search_messages', {
    query,
    before_created: cursor?.createdAt,
    before_id: cursor?.id,
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
      createdAt: row.created_at,
      fuzzy: row.fuzzy === true,
    };
  });
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      items.length === SEARCH_MESSAGES_PAGE_SIZE && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

/** Совпадение поиска по одному чату. */
export type ChatSearchHit = {
  id: string;
  authorId: string | null;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  text: string;
  createdAt: string;
};

export type ChatSearchPage = {
  items: ChatSearchHit[];
  nextCursor: SearchMessagesCursor | null;
};

/** Сколько совпадений за раз. Стрелки листают их по одному, догружая страницы. */
export const CHAT_SEARCH_PAGE_SIZE = 50;

/** Совпадения в тексте сообщений одного чата, свежие сверху, страницей. */
export async function searchChatMessages(
  chatId: string,
  query: string,
  cursor: SearchMessagesCursor | null,
  signal?: AbortSignal,
): Promise<ChatSearchPage> {
  let request = supabase.rpc('search_chat_messages', {
    target_chat: chatId,
    query,
    before_created: cursor?.createdAt,
    before_id: cursor?.id,
    page_size: CHAT_SEARCH_PAGE_SIZE,
  });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  const items: ChatSearchHit[] = (data ?? []).map((row) => ({
    id: row.message_id,
    authorId: row.author_id ?? null,
    authorName: row.author_name ?? null,
    text: row.text ?? '',
    createdAt: row.created_at,
  }));
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      items.length === CHAT_SEARCH_PAGE_SIZE && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

/** Сколько всего совпадений в чате; дальше 1000 база не считает. */
export async function countChatSearch(
  chatId: string,
  query: string,
  signal?: AbortSignal,
): Promise<number> {
  let request = supabase.rpc('count_chat_search', { target_chat: chatId, query });

  if (signal) request = request.abortSignal(signal);

  const { data, error } = await request;

  if (error) throw error;

  return data ?? 0;
}
