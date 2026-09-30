// Как история чата догоняет базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS.

import type { QueryClient } from '@tanstack/react-query';

import {
  listDeletedMessageIds,
  listMessageEdits,
  listMessages,
  listMessagesByIds,
  listMessagesSince,
  MESSAGE_PAGE_SIZE,
  type Message,
} from '@/api/chats';
import { listMessageReactions } from '@/api/reactions';
import {
  knownEdits,
  mergeMessages,
  patchReactions,
  quotedIds,
  readHistory,
  removeMessages,
  replaceMessages,
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

  const loadedIds = [...cached.items.map((message) => message.id), ...quotedIds(cached)].slice(
    0,
    MAX_TOMBSTONE_IDS,
  );
  const [newer, deleted, edited, reactions] = await Promise.all([
    fetchNewer(chatId, since),
    listDeletedMessageIds(loadedIds),
    fetchStaleEdits(cached, loadedIds),
    // Счётчики пропущенных реакций. Не вышло — не повод ронять дочитывание:
    // их принесёт следующее событие или вход в чат.
    listMessageReactions(cached.items.slice(0, MAX_TOMBSTONE_IDS).map((message) => message.id)).catch(
      () => [],
    ),
  ]);

  if (newer === null) return firstPage(chatId);

  const latest = readHistory(queryClient, chatId) ?? cached;

  return patchReactions(
    replaceMessages(
      removeMessages(mergeMessages(latest, newer, 'newer'), new Set(deleted)),
      edited,
    ),
    reactions,
  );
}

/** Свежие версии тех из `ids`, что правили после того, как их показали. */
async function fetchStaleEdits(history: ChatHistory, ids: string[]): Promise<Message[]> {
  const known = knownEdits(history);
  const edits = await listMessageEdits(ids);
  const stale = edits.filter((edit) => known.get(edit.id) !== edit.editedAt).map((edit) => edit.id);

  return listMessagesByIds(stale);
}

/**
 * Сообщение отредактировали — перечитать его, если оно на экране или
 * процитировано в том, что на экране. Иначе и читать незачем: придёт
 * свежим со страницей истории.
 */
export async function refreshEditedMessages(
  queryClient: QueryClient,
  chatId: string,
  candidates: string[],
): Promise<void> {
  const known = knownEdits(readHistory(queryClient, chatId));
  const ids = candidates.filter((id) => known.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessagesByIds(ids);

  if (fresh.length === 0) return;

  updateHistory(queryClient, chatId, (current) => replaceMessages(current, fresh));
}

/** Убирает с экрана то, что база подтверждает удалённым, — среди `candidates`. */
export async function dropDeletedMessages(
  queryClient: QueryClient,
  chatId: string,
  candidates: string[],
): Promise<void> {
  const history = readHistory(queryClient, chatId);
  // Удалённое может быть и не загружено, но процитировано в загруженном ответе.
  const loaded = new Set([
    ...(history?.items.map((message) => message.id) ?? []),
    ...quotedIds(history),
  ]);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const deleted = await listDeletedMessageIds(ids);

  if (deleted.length === 0) return;

  updateHistory(queryClient, chatId, (current) => removeMessages(current, new Set(deleted)));
}

/**
 * Реакции на эти сообщения изменились — перечитать счётчики пачкой, одним
 * запросом, и только у загруженных: остальные придут свежими со страницей.
 */
export async function refreshReactions(
  queryClient: QueryClient,
  chatId: string,
  candidates: string[],
): Promise<void> {
  const loaded = new Set(readHistory(queryClient, chatId)?.items.map((message) => message.id));
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessageReactions(ids);

  updateHistory(queryClient, chatId, (current) => patchReactions(current, fresh));
}
