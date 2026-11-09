// Как история чата догоняет базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS.

import type { QueryClient } from '@tanstack/react-query';

import { readChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import {
  deletedChatThreadRoot,
  listCommentCounts,
  listClusterCounts,
  listDeletedMessageIds,
  listMessageEdits,
  listMessages,
  listMessagesByIds,
  listMessagesSince,
  MESSAGE_PAGE_SIZE,
  type Message,
} from '@/api/chats';
import { listChatThreadFeed, listChatThreadFeedSince } from '@/api/chats';
import { listMessageViews } from '@/api/messageViews';
import { listMessageReactions } from '@/api/reactions';
import { originalIds } from '@/features/chats/islands/islandCache';
import {
  knownEdits,
  mergeMessages,
  messagesQueryKey,
  newestSeq,
  patchCommentCounts,
  patchClusterCounts,
  patchReactions,
  patchViews,
  quotedIds,
  readAllHistories,
  readHistory,
  removeMessages,
  replaceMessages,
  toSent,
  updateAllHistories,
  updateChatHistories,
  updateHistory,
  type ChatHistory,
  type HistoryView,
} from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Сколько страниц новых сообщений дочитывать за раз, прежде чем начать заново. */
const MAX_CATCH_UP_PAGES = 5;
/** Столько id за раз принимает `message_tombstones`. */
const MAX_TOMBSTONE_IDS = 1000;

/** Страница назад в ленте `view`: вся переписка или «Треды» — без ответов. */
export function listHistoryPage(chatId: string, view: HistoryView, cursor?: number) {
  return view === 'all'
    ? listMessages(chatId, { cursor })
    : listChatThreadFeed(chatId, { cursor });
}

function listHistorySince(chatId: string, view: HistoryView, since: number) {
  return view === 'all' ? listMessagesSince(chatId, since) : listChatThreadFeedSince(chatId, since);
}

async function firstPage(chatId: string, view: HistoryView): Promise<ChatHistory> {
  const page = await listHistoryPage(chatId, view);

  return { items: page.items.map(toSent), nextCursor: page.nextCursor };
}

/**
 * Всё, что пришло после номера `since`, от старого к новому. `null` —
 * пропущено больше, чем имеет смысл дочитывать по страницам: дешевле начать
 * историю заново с первой страницы.
 */
async function fetchNewer(
  chatId: string,
  since: number,
  view: HistoryView,
): Promise<Message[] | null> {
  const newer: Message[] = [];
  let cursor = since;

  for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
    const batch = await listHistorySince(chatId, view, cursor);

    newer.push(...batch);

    if (batch.length < MESSAGE_PAGE_SIZE) return newer;

    cursor = batch[batch.length - 1].seq;
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
  view: HistoryView = 'all',
): Promise<Message[]> {
  const history = readHistory(queryClient, chatId, view);

  if (!history) return [];

  const since = newestSeq(history);
  // В пустом чате дочитывать не от чего — первое сообщение забираем обычной
  // страницей, иначе диалог оживает только после повторного входа.
  const fetched = since !== null ? await fetchNewer(chatId, since, view) : null;
  if (since !== null && fetched === null) {
    const latestPage = await firstPage(chatId, view);
    queryClient.setQueryData(messagesQueryKey(chatId, view), latestPage);
    return latestPage.items;
  }
  const incoming = since !== null
    ? (fetched ?? [])
    : [...(await listHistoryPage(chatId, view)).items].reverse();

  if (incoming.length > 0) {
    updateHistory(
      queryClient,
      chatId,
      (current) => mergeMessages(current, incoming, 'newer'),
      view,
    );
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
export async function loadHistory(
  queryClient: QueryClient,
  chatId: string,
  view: HistoryView = 'all',
): Promise<ChatHistory> {
  const cached = readHistory(queryClient, chatId, view);
  const since = cached ? newestSeq(cached) : null;

  if (!cached || since === null) return firstPage(chatId, view);

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
    fetchNewer(chatId, since, view),
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

  if (newer === null) return firstPage(chatId, view);

  const latest = readHistory(queryClient, chatId, view) ?? cached;
  // В «Тредах» удалённое без нас исходное с ответами остаётся заглушкой.
  const summaries = view === 'chat-threads' ? readChatThreadSummaries(queryClient, chatId) : undefined;
  const stubs = summaries
    ? latest.items
        .filter((message) => deleted.includes(message.id) && (summaries[message.id]?.repliesCount ?? 0) > 0)
        .map((message) => deletedChatThreadRoot(chatId, message.id, message.seq))
    : [];

  return patchViews(
    patchCommentCounts(
      patchReactions(
        replaceMessages(
          mergeMessages(
            removeMessages(mergeMessages(latest, newer, 'newer'), new Set(deleted)),
            stubs,
            'older',
          ),
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
  const stale = edits.filter((edit) => known.get(edit.id) !== edit.editMark).map((edit) => edit.id);

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

function editsEverywhere(queryClient: QueryClient): Map<string, number | null> {
  const known = new Map<string, number | null>();

  for (const history of readAllHistories(queryClient)) {
    knownEdits(history).forEach((editMark, id) => known.set(id, editMark));
  }

  return known;
}

/**
 * Участник чата сменил, кому видно время: перечитать всё загруженное этого
 * чата — время, даты и прочтение появляются или пропадают на месте, без
 * перезагрузки истории и без прыжка списка.
 */
export async function refreshChatTimes(queryClient: QueryClient, chatId: string): Promise<void> {
  // «Треды» и шторки могут содержать сообщения, которых ещё нет в обычной
  // истории. Смена приватности обновляет каждое место показа.
  const ids = [...new Set(readAllHistories(queryClient).flatMap((history) => [
    ...history.items.filter((message) => message.chatId === chatId && message.status === 'sent')
      .map((message) => message.id),
    ...quotedIds(history),
    ...originalIds(history.items),
  ]))];

  if (ids.length === 0) return;

  for (let start = 0; start < ids.length; start += MAX_TOMBSTONE_IDS) {
    const fresh = await listMessagesByIds(ids.slice(start, start + MAX_TOMBSTONE_IDS));
    updateAllHistories(queryClient, (current) => replaceMessages(current, fresh));
  }
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

/** Пересчёт поменял показываемые кластеры этих сообщений — перечитать числа пачкой, только у загруженных. */
export async function refreshClusterCounts(
  queryClient: QueryClient,
  candidates: string[],
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listClusterCounts(ids);

  updateAllHistories(queryClient, (current) => patchClusterCounts(current, fresh));
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
  const loaded = readAllHistories(queryClient).some((history) =>
    history.items.some((message) => message.id === forwardId),
  );

  if (!loaded) return;

  const [fresh] = await listMessagesByIds([forwardId]);

  updateChatHistories(queryClient, chatId, (current) =>
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
