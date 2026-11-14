// Загруженная история чата в кеше TanStack Query: самые новые первыми, плюс
// курсор к следующей странице назад. Всё, что меняет историю, — первая
// страница, догрузка, Realtime, удаление, подтверждённая отправка — пишет
// сюда функциональным обновлением, поэтому одновременные изменения не
// затирают друг друга.
//
// Страницы не хранятся по отдельности намеренно: `useInfiniteQuery` склеивает
// догруженную страницу со страницами, какими они были в начале запроса, и
// тем самым выбрасывает всё, что пришло в кеш за время догрузки.

import type { QueryClient } from '@tanstack/react-query';

import type { Message } from '@/api/chats';
import type { HistoryCursor, HistoryPosition } from '@/api/historyWindow';
import { PENDING_SEQ } from '@/api/pendingSeq';
import type { MessageViews } from '@/api/messageViews';
import type { MessageReactions } from '@/api/reactionCounts';
import { mapOriginals, withFreshContent, withoutItems } from '@/features/chats/islands/islandCache';
import { previewOf as previewOfMessage } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';
import { sameReactions } from '@/features/interactions/reactionState';

export type ChatHistory = {
  /** Newest first — the list that renders them is inverted. */
  items: ChatMessage[];
  /** Main history uses an element cursor; thread APIs still use parent seq. */
  nextCursor: number | HistoryCursor<'before'> | null;
  afterCursor?: HistoryCursor<'after'> | null;
};

/**
 * Какая лента чата: вся переписка или вид «Треды» — без ответов (их ключ —
 * под ключом чата: всё, что меняет загруженные сообщения во всех историях,
 * доходит и до неё).
 */
export type HistoryView = 'all' | 'chat-threads';

export function messagesQueryKey(chatId: string, view: HistoryView = 'all') {
  return view === 'all' ? (['messages', chatId] as const) : (['messages', chatId, view] as const);
}

export function toSent(message: Message): ChatMessage {
  return { ...message, status: 'sent' };
}

// Порядок — по номеру сервера: время бывает скрыто. Неподтверждённые стоят
// выше любого настоящего номера (`PENDING_SEQ`).
function byNewest(a: ChatMessage, b: ChatMessage): number {
  return b.seq - a.seq;
}

/** Номер самого свежего подтверждённого сообщения истории; `null` — таких нет. */
export function newestSeq(history: ChatHistory): number | null {
  let newest: number | null = null;

  for (const message of history.items) {
    if (message.seq < PENDING_SEQ && (newest === null || message.seq > newest))
      newest = message.seq;
  }

  return newest;
}

export function newestPosition(history: ChatHistory): HistoryPosition | null {
  const seq = newestSeq(history);
  if (seq === null) return null;
  const message = history.items.find((item) => item.seq === seq);
  return {
    seq,
    position: Math.max(0, ...(message?.forward?.items.map((item) => item.position) ?? [])),
  };
}

/**
 * Вливает сообщения в историю: уже известные остаются как есть (у своего
 * отправленного там локальные превью), новые встают по номеру.
 *
 * `newer` — пришедшее после загруженного, в порядке от старого к новому
 * (так его отдаёт дочитывание); `older` — страница назад, от нового к старому.
 */
export function mergeMessages(
  history: ChatHistory,
  incoming: Message[],
  direction: 'newer' | 'older',
): ChatHistory {
  const byId = new Map(history.items.map((message) => [message.id, message]));
  const addedIds: string[] = [];
  let changed = false;
  for (const message of incoming) {
    const known = byId.get(message.id);
    if (!known) {
      byId.set(message.id, toSent(message));
      addedIds.push(message.id);
      changed = true;
    } else if (known.forward && message.forward) {
      // Cache groups contain only loaded occurrences. Pagination identity is
      // still each item.id; grouping never fetches or invents missing siblings.
      const ids = new Set(known.forward.items.map((item) => item.id));
      const added = message.forward.items.filter((item) => !ids.has(item.id));
      const range = message.forwardRange;
      const forwardRange = range
        ? {
            start: Math.min(known.forwardRange?.start ?? range.start, range.start),
            end: Math.max(known.forwardRange?.end ?? range.end, range.end),
          }
        : known.forwardRange;
      if (
        added.length ||
        forwardRange?.start !== known.forwardRange?.start ||
        forwardRange?.end !== known.forwardRange?.end
      ) {
        byId.set(message.id, {
          ...known,
          ...(forwardRange ? { forwardRange } : {}),
          forward: {
            ...known.forward,
            items: [...known.forward.items, ...added].sort((a, b) => a.position - b.position),
          },
        });
        changed = true;
      }
    }
  }
  if (!changed) return history;
  const existing = history.items.map((message) => byId.get(message.id)!);
  const added = addedIds.map((id) => byId.get(id)!);
  const items = direction === 'newer' ? [...added.reverse(), ...existing] : [...existing, ...added];
  return { ...history, items: items.sort(byNewest) };
}

/** Цитаты удалённых сообщений в ответах — «Сообщение удалено», ответ остаётся. */
function markQuotesDeleted(message: ChatMessage, ids: ReadonlySet<string>): ChatMessage {
  if (!message.replies.some((quote) => quote.state === 'live' && ids.has(quote.messageId))) {
    return message;
  }

  return {
    ...message,
    replies: message.replies.map((quote) =>
      quote.state === 'live' && ids.has(quote.messageId)
        ? { messageId: quote.messageId, state: 'deleted' }
        : quote,
    ),
  };
}

/**
 * Убирает удалённые сообщения. Удалённый оригинал в островке становится
 * заглушкой — островок не рассыпается, — а цитата удалённого в ответе —
 * «Сообщение удалено».
 */
export function removeMessages(history: ChatHistory, ids: ReadonlySet<string>): ChatHistory {
  let changed = false;
  const items: ChatMessage[] = [];

  for (const message of history.items) {
    // Заглушка удалённого исходного в «Тредах» и так стоит на месте удалённого.
    if (ids.has(message.id) && !message.chatThreadDeletedRoot) {
      changed = true;
      continue;
    }

    const marked = mapOriginals(markQuotesDeleted(message, ids), (original) =>
      ids.has(original.id) ? null : original,
    );

    if (marked !== message) changed = true;

    items.push(marked);
  }

  return changed ? { ...history, items } : history;
}

/**
 * Кладёт свежие версии сообщений на место загруженных — после правки. Новое
 * в историю не добавляется: сообщение из другого места переписки, которое
 * процитировано здесь или стоит в островке, меняет только цитаты и облачко
 * островка.
 *
 * Локальные превью у заменённого не переживают правку: вложения могли
 * смениться, а превью привязаны к позициям. Своё только что отправленное
 * правка получает с превью явно, через `localPreviews`.
 */
export function replaceMessages(
  history: ChatHistory,
  fresh: Message[],
  localPreviews: ReadonlyMap<string, string[]> = new Map(),
): ChatHistory {
  const byId = new Map(fresh.map((message) => [message.id, message]));

  if (byId.size === 0) return history;

  let changed = false;

  const items = history.items.map((message) => {
    const next = byId.get(message.id);
    const quotes = message.replies.some(
      (quote) => quote.state === 'live' && byId.has(quote.messageId),
    );

    let base: ChatMessage = next
      ? { ...message, ...next, status: 'sent', localPreviews: localPreviews.get(next.id) }
      : message;

    if (quotes) {
      base = {
        ...base,
        replies: base.replies.map((quote) => {
          const quoted = quote.state === 'live' ? byId.get(quote.messageId) : undefined;

          return quoted && quote.state === 'live'
            ? {
                ...quote,
                createdAt: quoted.createdAt,
                editMark: quoted.editMark,
                preview: previewOfMessage(quoted),
              }
            : quote;
        }),
      };
    }

    base = mapOriginals(base, (original) => {
      const version = byId.get(original.id);

      return version ? withFreshContent(original, version) : original;
    });

    if (base !== message) changed = true;

    return base;
  });

  return changed ? { ...history, items } : history;
}

/** Переславший убрал облачка из островка — у нас их тоже больше нет. */
export function removeIslandItems(
  history: ChatHistory,
  forwardId: string,
  messageIds: ReadonlySet<string>,
): ChatHistory {
  let changed = false;
  const items: ChatMessage[] = [];

  for (const message of history.items) {
    const next = message.id === forwardId ? withoutItems(message, messageIds) : message;

    if (next !== message) changed = true;
    if (next) items.push(next);
  }

  return changed ? { ...history, items } : history;
}

/**
 * Кладёт свежие реакции на загруженные сообщения. Всё остальное в облачке не
 * трогается, и строка, у которой счётчики не изменились, остаётся тем же
 * объектом — список её не перерисовывает.
 */
export function patchReactions(
  history: ChatHistory,
  fresh: { id: string; reactions: MessageReactions }[],
): ChatHistory {
  if (fresh.length === 0) return history;

  const byId = new Map(fresh.map((row) => [row.id, row.reactions]));
  let changed = false;

  const items = history.items.map((message) => {
    const reactions = byId.get(message.id);
    const own =
      !reactions || sameReactions(message.reactions, reactions)
        ? message
        : { ...message, reactions };
    const next = mapOriginals(own, (original) => {
      const fresh = byId.get(original.id);

      return !fresh || sameReactions(original.reactions, fresh)
        ? original
        : { ...original, reactions: fresh };
    });

    if (next !== message) changed = true;

    return next;
  });

  return changed ? { ...history, items } : history;
}

/** Кладёт свежие числа комментариев на загруженные сообщения — как `patchReactions`. */
export function patchCommentCounts(
  history: ChatHistory,
  fresh: { id: string; commentsCount: number }[],
): ChatHistory {
  if (fresh.length === 0) return history;

  const byId = new Map(fresh.map((row) => [row.id, row.commentsCount]));
  let changed = false;

  const items = history.items.map((message) => {
    const count = byId.get(message.id);
    const own =
      count === undefined || count === message.commentsCount
        ? message
        : { ...message, commentsCount: count };
    const next = mapOriginals(own, (original) => {
      const fresh = byId.get(original.id);

      return fresh === undefined || fresh === original.commentsCount
        ? original
        : { ...original, commentsCount: fresh };
    });

    if (next !== message) changed = true;

    return next;
  });

  return changed ? { ...history, items } : history;
}

/**
 * Свежие числа показываемых кластеров — у сообщений и у оригиналов в островках:
 * от них ореол облачка и вход участника в режим фрагментов.
 */
export function patchClusterCounts(
  history: ChatHistory,
  fresh: { id: string; clustersCount: number }[],
): ChatHistory {
  if (fresh.length === 0) return history;

  const byId = new Map(fresh.map((row) => [row.id, row.clustersCount]));
  const apply = <T extends Message>(message: T): T => {
    const count = byId.get(message.id);

    return count === undefined || count === (message.clustersCount ?? 0)
      ? message
      : { ...message, clustersCount: count };
  };
  let changed = false;

  const items = history.items.map((message) => {
    const next = mapOriginals(apply(message), apply);

    if (next !== message) changed = true;

    return next;
  });

  return changed ? { ...history, items } : history;
}

/** Просмотры и «прочитано» из базы — у сообщений и у оригиналов в островках. */
export function patchViews(history: ChatHistory, fresh: MessageViews[]): ChatHistory {
  if (fresh.length === 0) return history;

  const byId = new Map(fresh.map((row) => [row.id, row]));
  const apply = <T extends Message>(message: T): T => {
    const row = byId.get(message.id);

    return !row || (row.viewsCount === message.viewsCount && row.readAt === message.readAt)
      ? message
      : { ...message, viewsCount: row.viewsCount, readAt: row.readAt };
  };
  let changed = false;

  const items = history.items.map((message) => {
    const next = mapOriginals(apply(message), apply);

    if (next !== message) changed = true;

    return next;
  });

  return changed ? { ...history, items } : history;
}

/**
 * Прибавляет к числу комментариев сообщения — везде, где оно показано: в
 * своём чате и в островках. Свой комментарий виден в кружке сразу, до ответа
 * сервера; точное число потом кладёт `patchCommentCounts`.
 */
export function bumpCommentsCount(
  history: ChatHistory,
  messageId: string,
  delta: number,
): ChatHistory {
  let changed = false;

  const items = history.items.map((message) => {
    const own =
      message.id === messageId
        ? { ...message, commentsCount: Math.max(0, message.commentsCount + delta) }
        : message;
    const next = mapOriginals(own, (original) =>
      original.id === messageId
        ? { ...original, commentsCount: Math.max(0, original.commentsCount + delta) }
        : original,
    );

    if (next !== message) changed = true;

    return next;
  });

  return changed ? { ...history, items } : history;
}

/** Номера правок, известные на экране, — чтобы знать, что уже устарело. */
export function knownEdits(history: ChatHistory | undefined): Map<string, number | null> {
  const known = new Map<string, number | null>();

  for (const message of history?.items ?? []) {
    known.set(message.id, message.editMark);

    for (const item of message.forward?.items ?? []) {
      if (item.original) known.set(item.original.id, item.original.editMark);
    }

    for (const quote of message.replies) {
      if (quote.state === 'live' && !known.has(quote.messageId)) {
        known.set(quote.messageId, quote.editMark);
      }
    }
  }

  return known;
}

/** id сообщений, процитированных в загруженных ответах и ещё живых. */
export function quotedIds(history: ChatHistory | undefined): string[] {
  const ids = new Set<string>();

  for (const message of history?.items ?? []) {
    for (const quote of message.replies) {
      if (quote.state === 'live') ids.add(quote.messageId);
    }
  }

  return [...ids];
}

/** Возвращает на место сообщения, которые сервер отказался удалять. */
export function restoreMessages(history: ChatHistory, messages: ChatMessage[]): ChatHistory {
  const known = new Set(history.items.map((message) => message.id));
  const missing = messages.filter((message) => !known.has(message.id));

  if (missing.length === 0) return history;

  return { ...history, items: [...history.items, ...missing].sort(byNewest) };
}

export function readHistory(
  queryClient: QueryClient,
  chatId: string,
  view: HistoryView = 'all',
): ChatHistory | undefined {
  return queryClient.getQueryData<ChatHistory>(messagesQueryKey(chatId, view));
}

/** Все загруженные истории — у оригинала бывают копии в островках чужих чатов. */
export function readAllHistories(queryClient: QueryClient): ChatHistory[] {
  return [...queryClient.getQueriesData<ChatHistory>({ queryKey: ['messages'] })].flatMap(
    ([, history]) => (history ? [history] : []),
  );
}

/** Меняет все загруженные истории разом — оригинал везде, где он показан. */
export function updateAllHistories(
  queryClient: QueryClient,
  update: (history: ChatHistory) => ChatHistory,
) {
  queryClient.setQueriesData<ChatHistory>({ queryKey: ['messages'] }, (history) =>
    history ? update(history) : history,
  );
}

/**
 * Меняет историю, если она загружена. Незагруженную не создаёт: пустая
 * история с `nextCursor: null` соврала бы экрану, что сообщений нет вовсе.
 */
export function updateHistory(
  queryClient: QueryClient,
  chatId: string,
  update: (history: ChatHistory) => ChatHistory,
  view: HistoryView = 'all',
) {
  queryClient.setQueryData<ChatHistory>(messagesQueryKey(chatId, view), (history) =>
    history ? update(history) : history,
  );
}

/** Меняет все истории чата разом: переписку, «Треды» и открытые треды. */
export function updateChatHistories(
  queryClient: QueryClient,
  chatId: string,
  update: (history: ChatHistory) => ChatHistory,
) {
  queryClient.setQueriesData<ChatHistory>({ queryKey: messagesQueryKey(chatId) }, (history) =>
    history ? update(history) : history,
  );
}
