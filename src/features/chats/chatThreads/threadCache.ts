// Тред в шторке — в кеше запросов под ключом чата (`['messages', chatId,
// 'chat-thread', rootId]`): правки, удаления, реакции, комментарии и просмотры,
// которые сигналы раскладывают по всем историям, доходят и сюда сами.
//
// Форма — та же история переписки (новыми вперёд), плюс цитаты, входящие в
// тред, и разрыв между загруженным началом и хвостом длинного треда. Корень
// лежит среди сообщений: у него самый маленький номер.

import type { QueryClient } from '@tanstack/react-query';

import {
  deletedChatThreadRoot,
  listChatThread,
  listDeletedMessageIds,
  listMessagesByIds,
  type ChatThreadPage,
  type Message,
} from '@/api/chats';
import {
  mergeMessages,
  messagesQueryKey,
  newestSeq,
  removeMessages,
  toSent,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';

export type ChatThreadGap = {
  /** Последний загруженный номер начала. */
  afterSeq: number;
  /** Первый загруженный номер хвоста. */
  beforeSeq: number;
};

export type ChatThreadHistory = ChatHistory & {
  rootId: string;
  /** id ответа → его цитаты из этого треда, кроме корня. Только их показывает шторка. */
  quotes: Record<string, string[]>;
  /** Между началом и хвостом есть незагруженные ответы. */
  gap: ChatThreadGap | null;
};

/**
 * Первая загрузка — начало и хвост треда, вместе в страницу: тред длиннее
 * страницы открывается с разрывом «показать ещё» между ними.
 */
const HEAD_SIZE = 20;
const TAIL_SIZE = 10;
/** Сколько страниц новых ответов дочитывать по сигналу, прежде чем перечитать тред заново. */
const MAX_CATCH_UP_PAGES = 5;

export function chatThreadQueryKey(chatId: string, rootId: string) {
  return [...messagesQueryKey(chatId), 'chat-thread', rootId] as const;
}

export function readChatThread(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
): ChatThreadHistory | undefined {
  return queryClient.getQueryData<ChatThreadHistory>(chatThreadQueryKey(chatId, rootId));
}

export function updateChatThread(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
  update: (thread: ChatThreadHistory) => ChatThreadHistory,
) {
  queryClient.setQueryData<ChatThreadHistory>(chatThreadQueryKey(chatId, rootId), (thread) =>
    thread ? update(thread) : thread,
  );
}

/** Вливает страницу треда: ответы и их цитаты. */
export function mergeChatThreadPage(
  thread: ChatThreadHistory,
  page: Pick<ChatThreadPage, 'items' | 'quotes'>,
): ChatThreadHistory {
  const merged = mergeMessages(thread, page.items, 'newer');

  return { ...thread, ...merged, quotes: { ...thread.quotes, ...page.quotes } };
}

/**
 * Первая загрузка: корень, начало треда и, если тред длиннее страницы, его
 * хвост — между ними разрыв «показать ещё».
 */
async function firstLoad(chatId: string, rootId: string): Promise<ChatThreadHistory> {
  const [[root], head] = await Promise.all([
    listMessagesByIds([rootId]),
    listChatThread(rootId, { limit: HEAD_SIZE }),
  ]);
  const tail = head.full
    ? await listChatThread(rootId, { beforeSeq: 'end', limit: TAIL_SIZE })
    : null;
  const headLast = head.items[head.items.length - 1]?.seq ?? null;
  const tailFirst = tail?.items[0]?.seq ?? null;
  const gap =
    headLast !== null && tailFirst !== null && tailFirst > headLast
      ? { afterSeq: headLast, beforeSeq: tailFirst }
      : null;
  const empty: ChatThreadHistory = { items: [], nextCursor: null, rootId, quotes: {}, gap };
  const withRoot = mergeChatThreadPage(empty, {
    items: [root ?? deletedChatThreadRoot(chatId, rootId, 0)],
    quotes: {},
  });
  const withHead = mergeChatThreadPage(withRoot, head);

  return tail ? mergeChatThreadPage(withHead, tail) : withHead;
}

/** Ответы после самого нового загруженного, старые первыми; `null` — пропущено слишком много. */
async function fetchNewer(
  rootId: string,
  since: number,
): Promise<Pick<ChatThreadPage, 'items' | 'quotes'> | null> {
  const items: Message[] = [];
  const quotes: Record<string, string[]> = {};
  let cursor = since;

  for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
    const batch = await listChatThread(rootId, { afterSeq: cursor });

    items.push(...batch.items);
    Object.assign(quotes, batch.quotes);

    if (!batch.full || batch.items.length === 0) return { items, quotes };

    cursor = batch.items[batch.items.length - 1].seq;
  }

  return null;
}

/**
 * Загрузка треда для кеша. Повторно — дочитывание, как у переписки: новые
 * ответы и сверка, что из загруженного удалили. Перезагрузка выбросила бы
 * догруженное и сдвинула шторку под пальцем.
 */
export async function loadChatThread(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
): Promise<ChatThreadHistory> {
  const cached = readChatThread(queryClient, chatId, rootId);
  const since = cached ? newestSeq(cached) : null;

  if (!cached || since === null) return firstLoad(chatId, rootId);

  const loaded = cached.items.map((message) => message.id);
  const [newer, deleted] = await Promise.all([
    fetchNewer(rootId, since),
    listDeletedMessageIds(loaded),
  ]);

  if (newer === null) return firstLoad(chatId, rootId);

  const latest = readChatThread(queryClient, chatId, rootId) ?? cached;
  const pruned = removeMessages(latest, new Set(deleted));

  return mergeChatThreadPage({ ...latest, ...pruned }, newer);
}

/** Новые ответы треда — на сигнал «пришло сообщение», пока шторка открыта. */
export async function pullChatThread(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
): Promise<void> {
  const cached = readChatThread(queryClient, chatId, rootId);
  const since = cached ? newestSeq(cached) : null;

  if (!cached || since === null) return;

  const newer = await fetchNewer(rootId, since);

  if (!newer) {
    void queryClient.invalidateQueries({ queryKey: chatThreadQueryKey(chatId, rootId) });
    return;
  }

  if (newer.items.length === 0) return;

  updateChatThread(queryClient, chatId, rootId, (thread) => mergeChatThreadPage(thread, newer));
}

/** «Показать ещё»: следующая страница после начала. Разрыв закрывается, когда дошли до хвоста. */
export async function loadChatThreadGap(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
): Promise<void> {
  const gap = readChatThread(queryClient, chatId, rootId)?.gap;

  if (!gap) return;

  const page = await listChatThread(rootId, { afterSeq: gap.afterSeq });

  updateChatThread(queryClient, chatId, rootId, (thread) => {
    if (!thread.gap) return thread;

    const merged = mergeChatThreadPage(thread, {
      items: page.items.filter((message) => message.seq < thread.gap!.beforeSeq),
      quotes: page.quotes,
    });
    const last = page.items[page.items.length - 1]?.seq ?? null;
    const closed = !page.full || last === null || last >= thread.gap.beforeSeq;

    return { ...merged, gap: closed ? null : { ...thread.gap, afterSeq: last } };
  });
}

/** Своё подтверждённое — в шторку треда сразу, с цитатами, которые известны шторке. */
export function settleIntoChatThread(
  queryClient: QueryClient,
  chatId: string,
  rootId: string,
  saved: Message,
) {
  updateChatThread(queryClient, chatId, rootId, (thread) => {
    const inThread = new Set(thread.items.map((message) => message.id));
    const quotes = saved.replies
      .filter((quote) => quote.messageId !== rootId && !quote.via && inThread.has(quote.messageId))
      .map((quote) => quote.messageId);

    return mergeChatThreadPage(thread, { items: [toSent(saved)], quotes: { [saved.id]: quotes } });
  });
}
