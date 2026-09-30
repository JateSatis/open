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
import type { MessageReactions } from '@/api/reactionCounts';
import {
  mapOriginals,
  withFreshContent,
  withoutItems,
} from '@/features/chats/islands/islandCache';
import { previewOf as previewOfMessage } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';
import { sameReactions } from '@/features/interactions/reactionState';

export type ChatHistory = {
  /** Newest first — the list that renders them is inverted. */
  items: ChatMessage[];
  /** `createdAt` самого старого загруженного, пока глубже есть что грузить. */
  nextCursor: string | null;
};

export function messagesQueryKey(chatId: string) {
  return ['messages', chatId] as const;
}

export function toSent(message: Message): ChatMessage {
  return { ...message, status: 'sent' };
}

function byNewest(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt === b.createdAt) return 0;

  return a.createdAt > b.createdAt ? -1 : 1;
}

/**
 * Вливает сообщения в историю: уже известные остаются как есть (у своего
 * отправленного там локальные превью), новые встают по времени.
 *
 * `newer` — пришедшее после загруженного, в порядке от старого к новому
 * (так его отдаёт дочитывание); `older` — страница назад, от нового к старому.
 * При равном времени новое встаёт над известным, старое — под ним.
 */
export function mergeMessages(
  history: ChatHistory,
  incoming: Message[],
  direction: 'newer' | 'older',
): ChatHistory {
  const known = new Set(history.items.map((message) => message.id));
  const added = incoming.filter((message) => !known.has(message.id)).map(toSent);

  if (added.length === 0) return history;

  const items =
    direction === 'newer' ? [...added.reverse(), ...history.items] : [...history.items, ...added];

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
    if (ids.has(message.id)) {
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
            ? { ...quote, editedAt: quoted.editedAt, preview: previewOfMessage(quoted) }
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
      !reactions || sameReactions(message.reactions, reactions) ? message : { ...message, reactions };
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
 * Прибавляет к числу комментариев сообщения — везде, где оно показано: в
 * своём чате и в островках. Свой комментарий виден в кружке сразу, до ответа
 * сервера; точное число потом кладёт `patchCommentCounts`.
 */
export function bumpCommentsCount(history: ChatHistory, messageId: string, delta: number): ChatHistory {
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

/** Правленые версии, известные на экране, — чтобы знать, что уже устарело. */
export function knownEdits(history: ChatHistory | undefined): Map<string, string | null> {
  const known = new Map<string, string | null>();

  for (const message of history?.items ?? []) {
    known.set(message.id, message.editedAt);

    for (const item of message.forward?.items ?? []) {
      if (item.original) known.set(item.original.id, item.original.editedAt);
    }

    for (const quote of message.replies) {
      if (quote.state === 'live' && !known.has(quote.messageId)) {
        known.set(quote.messageId, quote.editedAt);
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

export function readHistory(queryClient: QueryClient, chatId: string): ChatHistory | undefined {
  return queryClient.getQueryData<ChatHistory>(messagesQueryKey(chatId));
}

/** Все загруженные истории — у оригинала бывают копии в островках чужих чатов. */
export function readAllHistories(queryClient: QueryClient): ChatHistory[] {
  return queryClient
    .getQueriesData<ChatHistory>({ queryKey: ['messages'] })
    .flatMap(([, history]) => (history ? [history] : []));
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
) {
  queryClient.setQueryData<ChatHistory>(messagesQueryKey(chatId), (history) =>
    history ? update(history) : history,
  );
}
