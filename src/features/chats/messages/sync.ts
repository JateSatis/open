// Как история чата догоняет базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS.

import type { QueryClient } from '@tanstack/react-query';

import {
  listDeletedMessageIds,
  listMessages,
  listMessagesSince,
  MESSAGE_PAGE_SIZE,
  type Message,
} from '@/api/chats';
import {
  mergeMessages,
  readHistory,
  removeMessages,
  toSent,
  updateHistory,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';

/** Сколько страниц новых сообщений дочитывать за раз, прежде чем начать заново. */
const MAX_CATCH_UP_PAGES = 5;
/** Столько id за раз принимает `message_tombstones`. */
const MAX_TOMBSTONE_IDS = 1000;

async function firstPage(chatId: string): Promise<ChatHistory> {
  const page = await listMessages(chatId);

  return { items: page.items.map(toSent), nextCursor: page.nextCursor };
}

/**
 * Всё, что пришло после `since`, от старого к новому. `null` — пропущено
 * больше, чем имеет смысл дочитывать по страницам: дешевле начать историю
 * заново с первой страницы.
 */
async function fetchNewer(chatId: string, since: string): Promise<Message[] | null> {
  const newer: Message[] = [];
  let cursor = since;

  for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
    const batch = await listMessagesSince(chatId, cursor);

    newer.push(...batch);

    if (batch.length < MESSAGE_PAGE_SIZE) return newer;

    cursor = batch[batch.length - 1].createdAt;
  }

  return null;
}

/**
 * Новые сообщения после самого свежего загруженного — на сигнал «пришло
 * сообщение». Отдаёт пришедшее; историю не трогает, если она ещё не
 * загружена: первая страница принесёт новое сама.
 */
export async function pullNewMessages(
  queryClient: QueryClient,
  chatId: string,
): Promise<Message[]> {
  const history = readHistory(queryClient, chatId);

  if (!history) return [];

  const since = history.items[0]?.createdAt;
  // В пустом чате дочитывать не от чего — первое сообщение забираем обычной
  // страницей, иначе диалог оживает только после повторного входа.
  const incoming = since
    ? ((await fetchNewer(chatId, since)) ?? [])
    : [...(await listMessages(chatId)).items].reverse();

  if (incoming.length > 0) {
    updateHistory(queryClient, chatId, (current) => mergeMessages(current, incoming, 'newer'));
  }

  return incoming;
}

/**
 * Загрузка истории для кеша запросов. Первый раз — первая страница. Потом —
 * дочитывание, а не перезагрузка: пришедшее после самого свежего и сверка,
 * что из загруженного удалили. Перезагрузка выбросила бы догруженное глубже,
 * и список прыгнул бы у человека под пальцем.
 *
 * Результат накладывается на историю, какой она стала к концу запроса, а не
 * на снимок в начале: за время запроса туда могли прийти и сообщения, и
 * догруженная страница.
 */
export async function loadHistory(queryClient: QueryClient, chatId: string): Promise<ChatHistory> {
  const cached = readHistory(queryClient, chatId);
  const since = cached?.items[0]?.createdAt;

  if (!cached || !since) return firstPage(chatId);

  const loadedIds = cached.items.map((message) => message.id).slice(0, MAX_TOMBSTONE_IDS);
  const [newer, deleted] = await Promise.all([
    fetchNewer(chatId, since),
    listDeletedMessageIds(loadedIds),
  ]);

  if (newer === null) return firstPage(chatId);

  const latest = readHistory(queryClient, chatId) ?? cached;

  return removeMessages(mergeMessages(latest, newer, 'newer'), new Set(deleted));
}

/** Убирает с экрана то, что база подтверждает удалённым, — среди `candidates`. */
export async function dropDeletedMessages(
  queryClient: QueryClient,
  chatId: string,
  candidates: string[],
): Promise<void> {
  const loaded = new Set(readHistory(queryClient, chatId)?.items.map((message) => message.id));
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const deleted = await listDeletedMessageIds(ids);

  if (deleted.length === 0) return;

  updateHistory(queryClient, chatId, (current) => removeMessages(current, new Set(deleted)));
}
