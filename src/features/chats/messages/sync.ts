// Как история чата догоняет базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS.

import type { QueryClient } from '@tanstack/react-query';

import {
  listCommentCounts,
  listDeletedMessageIds,
  listMessageEdits,
  listMessages,
  listMessagesByIds,
  listMessagesSince,
  MESSAGE_PAGE_SIZE,
  type Message,
} from '@/api/chats';
import { listMessageViews } from '@/api/messageViews';
import { listMessageReactions } from '@/api/reactions';
import { originalIds } from '@/features/chats/islands/islandCache';
import {
  knownEdits,
  mergeMessages,
  patchCommentCounts,
  patchReactions,
  patchViews,
  quotedIds,
  readAllHistories,
  readHistory,
  removeMessages,
  replaceMessages,
  toSent,
  updateAllHistories,
  updateHistory,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';

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

  // Оригиналы в островках — тоже загруженное: их правки, удаления, реакции и
  // комментарии за время обрыва дочитываются вместе с остальным.
  const originals = originalIds(cached.items);
  const loadedIds = [
    ...cached.items.map((message) => message.id),
    ...quotedIds(cached),
    ...originals,
  ].slice(0, MAX_TOMBSTONE_IDS);
  const loadedMessageIds = [...cached.items.map((message) => message.id), ...originals].slice(
    0,
    MAX_TOMBSTONE_IDS,
  );
  // Островки перечитываются целиком: из них могли убрать облачка.
  const islandIds = cached.items
    .filter((message) => message.kind === 'forward')
    .map((message) => message.id)
    .slice(0, MAX_TOMBSTONE_IDS);
  const [newer, deleted, edited, islands, reactions, commentCounts, views] = await Promise.all([
    fetchNewer(chatId, since),
    listDeletedMessageIds(loadedIds),
    fetchStaleEdits(cached, loadedIds),
    listMessagesByIds(islandIds),
    // Счётчики пропущенных реакций. Не вышло — не повод ронять дочитывание:
    // их принесёт следующее событие или вход в чат.
    listMessageReactions(loadedMessageIds).catch(() => []),
    // Числа комментариев — так же: пропущенное принесёт следующее событие.
    listCommentCounts(loadedMessageIds).catch(() => []),
    // Просмотры и «прочитано» — так же.
    listMessageViews(loadedMessageIds).catch(() => []),
  ]);

  if (newer === null) return firstPage(chatId);

  const latest = readHistory(queryClient, chatId) ?? cached;

  return patchViews(
    patchCommentCounts(
      patchReactions(
        replaceMessages(
          removeMessages(mergeMessages(latest, newer, 'newer'), new Set(deleted)),
          [...edited, ...islands],
        ),
        reactions,
      ),
      commentCounts,
    ),
    views,
  );
}

/** Свежие версии тех из `ids`, что правили после того, как их показали. */
async function fetchStaleEdits(history: ChatHistory, ids: string[]): Promise<Message[]> {
  const known = knownEdits(history);
  const edits = await listMessageEdits(ids);
  const stale = edits.filter((edit) => known.get(edit.id) !== edit.editedAt).map((edit) => edit.id);

  return listMessagesByIds(stale);
}

/** Всё загруженное во всех историях: сообщения, цитаты и оригиналы в островках. */
function loadedEverywhere(queryClient: QueryClient): Set<string> {
  const loaded = new Set<string>();

  for (const history of readAllHistories(queryClient)) {
    history.items.forEach((message) => loaded.add(message.id));
    quotedIds(history).forEach((id) => loaded.add(id));
    originalIds(history.items).forEach((id) => loaded.add(id));
  }

  return loaded;
}

function editsEverywhere(queryClient: QueryClient): Map<string, string | null> {
  const known = new Map<string, string | null>();

  for (const history of readAllHistories(queryClient)) {
    knownEdits(history).forEach((editedAt, id) => known.set(id, editedAt));
  }

  return known;
}

/**
 * Сообщение отредактировали — перечитать его, если оно на экране, процитировано
 * или стоит в островке где угодно в кеше. Иначе и читать незачем: придёт
 * свежим со страницей истории.
 */
export async function refreshEditedMessages(
  queryClient: QueryClient,
  candidates: string[],
): Promise<void> {
  const known = editsEverywhere(queryClient);
  const ids = candidates.filter((id) => known.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessagesByIds(ids);

  if (fresh.length === 0) return;

  updateAllHistories(queryClient, (current) => replaceMessages(current, fresh));
}

/**
 * Убирает с экрана то, что база подтверждает удалённым, — среди `candidates`.
 * Удалённый оригинал в островке становится заглушкой во всех чатах.
 */
export async function dropDeletedMessages(
  queryClient: QueryClient,
  candidates: string[],
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const deleted = await listDeletedMessageIds(ids);

  if (deleted.length === 0) return;

  updateAllHistories(queryClient, (current) => removeMessages(current, new Set(deleted)));
}

/**
 * Реакции на эти сообщения изменились — перечитать счётчики пачкой, одним
 * запросом, и только у загруженных: остальные придут свежими со страницей.
 * Оригинал в островках получает их там же.
 */
export async function refreshReactions(
  queryClient: QueryClient,
  candidates: string[],
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessageReactions(ids);

  updateAllHistories(queryClient, (current) => patchReactions(current, fresh));
}

/** Число комментариев у этих сообщений изменилось — перечитать пачкой, только у загруженных. */
export async function refreshCommentCounts(
  queryClient: QueryClient,
  candidates: string[],
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listCommentCounts(ids);

  updateAllHistories(queryClient, (current) => patchCommentCounts(current, fresh));
}

/** Просмотры и «прочитано» у этих сообщений изменились — перечитать пачкой, только у загруженных. */
export async function refreshViews(queryClient: QueryClient, candidates: string[]): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessageViews(ids);

  updateAllHistories(queryClient, (current) => patchViews(current, fresh));
}

/**
 * Из островка убрали облачка — перечитать его. Не вернулся — удалён: убрано
 * последнее.
 */
export async function refreshIsland(
  queryClient: QueryClient,
  chatId: string,
  forwardId: string,
): Promise<void> {
  const loaded = readHistory(queryClient, chatId)?.items.some((message) => message.id === forwardId);

  if (!loaded) return;

  const [fresh] = await listMessagesByIds([forwardId]);

  updateHistory(queryClient, chatId, (current) =>
    fresh ? replaceMessages(current, [fresh]) : removeMessages(current, new Set([forwardId])),
  );
}

/**
 * В чате оригиналов прочитали дальше — «прочитано» у своих облачек в островках
 * этого чата, где бы они ни были загружены.
 */
export function patchOriginChat(
  queryClient: QueryClient,
  originChatId: string,
  readUpTo: string | null,
) {
  const touch = (message: ChatMessage): ChatMessage => {
    if (message.kind !== 'forward' || !message.forward) return message;

    let changed = false;
    const items = message.forward.items.map((item) => {
      const chat = item.original?.chat;

      if (!item.original || chat?.id !== originChatId || chat.readUpTo === readUpTo) return item;

      changed = true;
      return { ...item, original: { ...item.original, chat: { ...chat, readUpTo } } };
    });

    return changed ? { ...message, forward: { ...message.forward, items } } : message;
  };

  updateAllHistories(queryClient, (history) => {
    const items = history.items.map(touch);

    return items.some((message, index) => message !== history.items[index])
      ? { ...history, items }
      : history;
  });
}
