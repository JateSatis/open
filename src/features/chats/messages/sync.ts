// Как история чата догоняет базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS.

import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';
import { getHistoryWindow, type HistoryPosition } from '@/api/historyWindow';
import { readForwardSlices, patchForwardSlices } from './forwardSlices';

import { readChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import {
  deletedChatThreadRoot,
  listCommentCounts,
  listClusterCounts,
  listDeletedMessageIds,
  listMessageEdits,
  listMessagesByIds,
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
  newestPosition,
  patchCommentCounts,
  patchClusterCounts,
  patchReactions,
  patchViews,
  quotedIds,
  readAllHistories,
  readHistory,
  removeMessages,
  replaceMessages,
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
const OPEN_HISTORY_ITEMS = 20;
const OLDER_HISTORY_ITEMS = 30;

/** Страница назад в ленте `view`: вся переписка или «Треды» — без ответов. */
export async function listHistoryPage(
  chatId: string,
  view: HistoryView,
  cursor?: NonNullable<ChatHistory['nextCursor']>,
  api = requestClient(),
) {
  if (view !== 'all')
    return listChatThreadFeed(chatId, {
      cursor: typeof cursor === 'number' ? cursor : cursor?.seq,
    }, api);
  const page = await getHistoryWindow(
    chatId,
    cursor === undefined
      ? { mode: 'latest', limit: OPEN_HISTORY_ITEMS }
      : {
          mode: 'before',
          limit: OLDER_HISTORY_ITEMS,
          cursor:
            typeof cursor === 'number'
              ? { chatId, direction: 'before', seq: cursor, position: 0 }
              : cursor,
        },
    api,
  );
  return { items: page.items.map((item) => item.message), nextCursor: page.before };
}

async function firstPage(chatId: string, view: HistoryView, api = requestClient()): Promise<ChatHistory> {
  const page = await listHistoryPage(chatId, view, undefined, api);

  return mergeMessages({ items: [], nextCursor: page.nextCursor }, page.items, 'older');
}

/**
 * Всё, что пришло после номера `since`, от старого к новому. `null` —
 * пропущено больше, чем имеет смысл дочитывать по страницам: дешевле начать
 * историю заново с первой страницы.
 */
async function fetchNewer(
  chatId: string,
  since: HistoryPosition,
  view: HistoryView,
  api = requestClient(),
): Promise<Message[] | null> {
  const newer: Message[] = [];
  let cursor = since;

  // Element pages can split just two sends into more than five pages. Resetting
  // here would discard the reading position and race with an older-page load.
  // Main history catches up incrementally through the one global cursor.
  for (let page = 0; view === 'all' || page < MAX_CATCH_UP_PAGES; page += 1) {
    const window =
      view === 'all'
        ? await getHistoryWindow(chatId, {
            mode: 'after',
            cursor: { chatId, direction: 'after', ...cursor },
          }, api)
        : null;
    const batch = window
      ? window.items.map((item) => item.message)
      : await listChatThreadFeedSince(chatId, cursor.seq, api);

    newer.push(...batch);

    if (window ? !window.after : batch.length < MESSAGE_PAGE_SIZE)
      return mergeMessages({ items: [], nextCursor: null }, newer, 'newer').items.reverse();

    cursor = window?.after ?? { seq: batch[batch.length - 1].seq, position: 0 };
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
  api = requestClient(),
): Promise<Message[]> {
  const history = readHistory(queryClient, chatId, view);

  if (!history) return [];

  const since = newestPosition(history);
  if (since === null) {
    const page = await firstPage(chatId, view, api);
    updateHistory(
      queryClient,
      chatId,
      (current) => ({
        ...mergeMessages(current, page.items, 'newer'),
        nextCursor: newestPosition(current) === null ? page.nextCursor : current.nextCursor,
      }),
      view,
    );
    return [...page.items].reverse();
  }
  // В пустом чате дочитывать не от чего — первое сообщение забираем обычной
  // страницей, иначе диалог оживает только после повторного входа.
  const fetched = await fetchNewer(chatId, since, view, api);
  if (fetched === null) {
    const latestPage = await firstPage(chatId, view, api);
    queryClient.setQueryData(messagesQueryKey(chatId, view), latestPage);
    return latestPage.items;
  }
  const incoming = fetched;

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
  api = requestClient(),
): Promise<ChatHistory> {
  const cached = readHistory(queryClient, chatId, view);
  const since = cached ? newestPosition(cached) : null;

  if (!cached || since === null) return firstPage(chatId, view, api);

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
  // Проверяем лишь загруженные элементы: группа могла потерять часть облачков.
  const [newer, deleted, edited, islands, reactions, commentCounts, views] = await Promise.all([
    fetchNewer(chatId, since, view, api),
    listDeletedMessageIds(loadedIds, api),
    fetchStaleEdits(cached, loadedIds, api),
    readForwardSlices(cached.items, api),
    // Счётчики пропущенных реакций. Не вышло — не повод ронять дочитывание:
    // их принесёт следующее событие или вход в чат.
    listMessageReactions(loadedMessageIds, api).catch(() => []),
    // Числа комментариев — так же: пропущенное принесёт следующее событие.
    listCommentCounts(loadedMessageIds, api).catch(() => []),
    // Просмотры и «прочитано» — так же.
    listMessageViews(loadedMessageIds, api).catch(() => []),
  ]);

  if (newer === null) return firstPage(chatId, view, api);

  const latest = readHistory(queryClient, chatId, view) ?? cached;
  // В «Тредах» удалённое без нас исходное с ответами остаётся заглушкой.
  const summaries =
    view === 'chat-threads' ? readChatThreadSummaries(queryClient, chatId) : undefined;
  const stubs = summaries
    ? latest.items
        .filter(
          (message) =>
            deleted.includes(message.id) && (summaries[message.id]?.repliesCount ?? 0) > 0,
        )
        .map((message) => deletedChatThreadRoot(chatId, message.id, message.seq))
    : [];

  return patchForwardSlices(
    patchViews(
      patchCommentCounts(
        patchReactions(
          replaceMessages(
            mergeMessages(
              removeMessages(mergeMessages(latest, newer, 'newer'), new Set(deleted)),
              stubs,
              'older',
            ),
            edited,
          ),
          reactions,
        ),
        commentCounts,
      ),
      views,
    ),
    islands,
  );
}

/** Свежие версии тех из `ids`, что правили после того, как их показали. */
async function fetchStaleEdits(history: ChatHistory, ids: string[], api = requestClient()): Promise<Message[]> {
  const known = knownEdits(history);
  const edits = await listMessageEdits(ids, api);
  const forwards = new Set(
    history.items
      .filter((message) => message.forward || message.forwardGroup)
      .map((message) => message.id),
  );
  const stale = edits
    .filter((edit) => !forwards.has(edit.id) && known.get(edit.id) !== edit.editMark)
    .map((edit) => edit.id);

  return listMessagesByIds(stale, api);
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
export async function refreshChatTimes(queryClient: QueryClient, chatId: string, api = requestClient()): Promise<void> {
  const snapshots = readAllHistories(queryClient).flatMap((history) => history.items);
  const forwards = new Set(
    snapshots
      .filter((message) => message.forward || message.forwardGroup)
      .map((message) => message.id),
  );
  const slices = await readForwardSlices(snapshots.filter((message) => message.chatId === chatId), api);
  updateAllHistories(queryClient, (history) => patchForwardSlices(history, slices));
  // «Треды» и шторки могут содержать сообщения, которых ещё нет в обычной
  // истории. Смена приватности обновляет каждое место показа.
  const ids = [
    ...new Set(
      readAllHistories(queryClient).flatMap((history) => [
        ...history.items
          .filter((message) => message.chatId === chatId && message.status === 'sent')
          .map((message) => message.id),
        ...quotedIds(history),
        ...originalIds(history.items),
      ]),
    ),
  ].filter((id) => !forwards.has(id));

  if (ids.length === 0) return;

  for (let start = 0; start < ids.length; start += MAX_TOMBSTONE_IDS) {
    const fresh = await listMessagesByIds(ids.slice(start, start + MAX_TOMBSTONE_IDS), api);
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
  api = requestClient(),
): Promise<void> {
  const known = editsEverywhere(queryClient);
  const snapshots = readAllHistories(queryClient).flatMap((history) => history.items);
  const forwards = new Set(
    snapshots
      .filter((message) => message.forward || message.forwardGroup)
      .map((message) => message.id),
  );
  const slices = await readForwardSlices(
    snapshots.filter((message) => candidates.includes(message.id)),
    api,
  );
  updateAllHistories(queryClient, (history) => patchForwardSlices(history, slices));
  const ids = candidates
    .filter((id) => known.has(id) && !forwards.has(id))
    .slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessagesByIds(ids, api);

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
  api = requestClient(),
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const deleted = await listDeletedMessageIds(ids, api);

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
  api = requestClient(),
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessageReactions(ids, api);

  updateAllHistories(queryClient, (current) => patchReactions(current, fresh));
}

/** Число комментариев у этих сообщений изменилось — перечитать пачкой, только у загруженных. */
export async function refreshCommentCounts(
  queryClient: QueryClient,
  candidates: string[],
  api = requestClient(),
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listCommentCounts(ids, api);

  updateAllHistories(queryClient, (current) => patchCommentCounts(current, fresh));
}

/** Пересчёт поменял показываемые кластеры этих сообщений — перечитать числа пачкой, только у загруженных. */
export async function refreshClusterCounts(
  queryClient: QueryClient,
  candidates: string[],
  api = requestClient(),
): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listClusterCounts(ids, api);

  updateAllHistories(queryClient, (current) => patchClusterCounts(current, fresh));
}

/** Просмотры и «прочитано» у этих сообщений изменились — перечитать пачкой, только у загруженных. */
export async function refreshViews(queryClient: QueryClient, candidates: string[], api = requestClient()): Promise<void> {
  const loaded = loadedEverywhere(queryClient);
  const ids = candidates.filter((id) => loaded.has(id)).slice(0, MAX_TOMBSTONE_IDS);

  if (ids.length === 0) return;

  const fresh = await listMessageViews(ids, api);

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
  api = requestClient(),
): Promise<void> {
  const loaded = readAllHistories(queryClient).some((history) =>
    history.items.some((message) => message.id === forwardId),
  );

  if (!loaded) return;

  const snapshot = readAllHistories(queryClient).flatMap((history) =>
    history.items.filter((message) => message.id === forwardId),
  );
  const fresh = await readForwardSlices(snapshot, api);

  updateChatHistories(queryClient, chatId, (current) => patchForwardSlices(current, fresh));
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
