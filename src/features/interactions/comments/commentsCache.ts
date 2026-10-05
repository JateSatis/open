// Загруженные комментарии сообщения в кеше TanStack Query — двух видов.
//
// Верх (`roots`) — верхнеуровневые комментарии в порядке ранга на момент
// загрузки. Порядок не пересчитывается на глазах: свежие счётчики и правки
// ложатся на место, а новый ранг — только при следующем открытии панели
// (панель забывает кеш при закрытии). Свои отправленные за это открытие и
// выделенный комментарий — отдельно, сверху (`pinned`).
//
// Тред (`thread`) — ответы одного корня по порядку. Начало треда (`head`)
// загружено подряд; за разрывом «Показать ещё» может лежать `tail` — свои
// только что отправленные ответы и цель прыжка. Когда начало догружено до
// конца, `tail` вливается в него.

import type { QueryClient } from '@tanstack/react-query';

import type { Comment, RootCursor } from '@/api/comments';
import { toCommentItem, type CommentItem } from '@/features/interactions/comments/commentItem';

export type RootsPage = {
  /** Свои отправленные за это открытие и выделенный — сверху, новыми вперёд. */
  pinned: CommentItem[];
  /** Остальные — по рангу на момент загрузки. */
  items: CommentItem[];
  nextCursor: RootCursor | null;
};

export type ThreadPage = {
  /** Начало треда уже читали с сервера. Без этого в кеше может лежать только `tail`. */
  headLoaded: boolean;
  /** Начало треда — подряд, сверху первые. */
  head: CommentItem[];
  /** Время последнего из `head`, пока дальше есть что грузить; `null` — начало дошло до конца. */
  nextCursor: string | null;
  /** Загруженное за разрывом: свои ответы и цель прыжка, по порядку. */
  tail: CommentItem[];
};

export function commentsKey(messageId: string) {
  return ['comments', messageId] as const;
}

export function rootsKey(messageId: string) {
  return ['comments', messageId, 'roots'] as const;
}

export function threadKey(messageId: string, rootId: string) {
  return ['comments', messageId, 'thread', rootId] as const;
}

export const EMPTY_THREAD: ThreadPage = { headLoaded: false, head: [], nextCursor: null, tail: [] };

function byTime(a: CommentItem, b: CommentItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rootsPageOf(page: { items: Comment[]; nextCursor: RootCursor | null }): RootsPage {
  return { pinned: [], items: page.items.map(toCommentItem), nextCursor: page.nextCursor };
}

/**
 * Следующая страница верха. Ранг между страницами мог вырасти, и уже
 * показанный комментарий придёт снова — повтор отсекается, строка остаётся
 * на своём месте.
 */
export function appendRoots(
  page: RootsPage,
  incoming: Comment[],
  nextCursor: RootCursor | null,
): RootsPage {
  const known = new Set([...page.pinned, ...page.items].map((item) => item.id));
  const added = incoming.filter((comment) => !known.has(comment.id)).map(toCommentItem);

  return { ...page, items: added.length > 0 ? [...page.items, ...added] : page.items, nextCursor };
}

/** Комментарий — в самый верх, до закрытия панели. Ниже он не повторяется. */
export function pinRoot(page: RootsPage, item: CommentItem): RootsPage {
  return {
    ...page,
    pinned: [item, ...page.pinned.filter((pinned) => pinned.id !== item.id)],
    items: page.items.some((other) => other.id === item.id)
      ? page.items.filter((other) => other.id !== item.id)
      : page.items,
  };
}

/** Порядок верха на экране: закреплённые, затем по рангу. */
export function rootsInOrder(page: RootsPage): CommentItem[] {
  return page.pinned.length === 0 ? page.items : [...page.pinned, ...page.items];
}

/**
 * Очередная порция начала треда. Догнали разрыв — то, что лежало за ним,
 * встаёт в начало, и разрыва больше нет.
 */
export function appendThreadHead(
  page: ThreadPage,
  incoming: Comment[],
  nextCursor: string | null,
): ThreadPage {
  const known = new Set(page.head.map((item) => item.id));
  const added = incoming.filter((comment) => !known.has(comment.id)).map(toCommentItem);
  const head = [...page.head, ...added].sort(byTime);
  const inHead = new Set(head.map((item) => item.id));
  const tail = page.tail.filter((item) => !inHead.has(item.id));

  if (nextCursor === null) {
    return { headLoaded: true, head: [...head, ...tail].sort(byTime), nextCursor: null, tail: [] };
  }

  return { headLoaded: true, head, nextCursor, tail };
}

/** Ответ — в конец треда: в начало, если оно загружено до конца, иначе за разрыв. */
export function addToThread(page: ThreadPage, item: CommentItem): ThreadPage {
  if ([...page.head, ...page.tail].some((other) => other.id === item.id)) return page;

  if (page.headLoaded && page.nextCursor === null) {
    return { ...page, head: [...page.head, item].sort(byTime) };
  }

  return { ...page, tail: [...page.tail, item].sort(byTime) };
}

/** Тред дочитан до конца: новый ответ встаёт в его конец без разрыва. */
export function isThreadComplete(page: ThreadPage | undefined): boolean {
  return Boolean(page?.headLoaded && page.nextCursor === null);
}

type Update = (item: CommentItem) => CommentItem | null;

function mapItems(items: CommentItem[], update: Update): CommentItem[] {
  let changed = false;
  const next: CommentItem[] = [];

  for (const item of items) {
    const result = update(item);

    if (result !== item) changed = true;
    if (result) next.push(result);
  }

  return changed ? next : items;
}

function isRootsPage(page: unknown): page is RootsPage {
  return typeof page === 'object' && page !== null && 'pinned' in page;
}

function isThreadPage(page: unknown): page is ThreadPage {
  return typeof page === 'object' && page !== null && 'head' in page;
}

function mapPage<T extends RootsPage | ThreadPage>(page: T, update: Update): T {
  if (isRootsPage(page)) {
    const pinned = mapItems(page.pinned, update);
    const items = mapItems(page.items, update);

    return pinned === page.pinned && items === page.items ? page : { ...page, pinned, items };
  }

  const thread = page as ThreadPage;
  const head = mapItems(thread.head, update);
  const tail = mapItems(thread.tail, update);

  return head === thread.head && tail === thread.tail ? page : ({ ...thread, head, tail } as T);
}

/**
 * Каждый загруженный комментарий сообщения — в верхе и во всех тредах.
 * `update` отдаёт тот же объект (не трогать), новый или `null` (убрать).
 */
export function updateAllComments(queryClient: QueryClient, messageId: string, update: Update) {
  queryClient.setQueriesData<RootsPage | ThreadPage>({ queryKey: commentsKey(messageId) }, (page) =>
    isRootsPage(page) || isThreadPage(page) ? mapPage(page, update) : page,
  );
}

/** То же по всем веткам всех сообщений — для того, что знает только id комментария. */
export function updateCommentEverywhere(queryClient: QueryClient, update: Update) {
  queryClient.setQueriesData<RootsPage | ThreadPage>({ queryKey: ['comments'] }, (page) =>
    isRootsPage(page) || isThreadPage(page) ? mapPage(page, update) : page,
  );
}

/** Все загруженные комментарии сообщения по id — и верх, и треды. */
export function loadedComments(queryClient: QueryClient, messageId: string): Map<string, CommentItem> {
  const found = new Map<string, CommentItem>();

  for (const [, page] of queryClient.getQueriesData({ queryKey: commentsKey(messageId) })) {
    if (isRootsPage(page)) {
      for (const item of [...page.pinned, ...page.items]) found.set(item.id, item);
    } else if (isThreadPage(page)) {
      for (const item of [...page.head, ...page.tail]) found.set(item.id, item);
    }
  }

  return found;
}

/** Загруженные треды сообщения: id корня → страница. */
export function loadedThreads(queryClient: QueryClient, messageId: string): Map<string, ThreadPage> {
  const threads = new Map<string, ThreadPage>();

  for (const [key, page] of queryClient.getQueriesData({ queryKey: [...commentsKey(messageId), 'thread'] })) {
    const rootId = key[3];

    if (typeof rootId === 'string' && isThreadPage(page)) threads.set(rootId, page);
  }

  return threads;
}

export function readRoots(queryClient: QueryClient, messageId: string): RootsPage | undefined {
  return queryClient.getQueryData<RootsPage>(rootsKey(messageId));
}

/** Меняет загруженный верх; незагруженный не создаёт — пустой список соврал бы, что комментариев нет. */
export function updateRoots(
  queryClient: QueryClient,
  messageId: string,
  update: (page: RootsPage) => RootsPage,
) {
  queryClient.setQueryData<RootsPage>(rootsKey(messageId), (page) => (page ? update(page) : page));
}

export function readThread(
  queryClient: QueryClient,
  messageId: string,
  rootId: string,
): ThreadPage | undefined {
  return queryClient.getQueryData<ThreadPage>(threadKey(messageId, rootId));
}

/**
 * Меняет тред. Незагруженный создаётся пустым только с `create`: свой ответ
 * должен дожить до того, как тред откроют и прочитают его начало.
 */
export function updateThread(
  queryClient: QueryClient,
  messageId: string,
  rootId: string,
  update: (page: ThreadPage) => ThreadPage,
  { create = false }: { create?: boolean } = {},
) {
  queryClient.setQueryData<ThreadPage>(threadKey(messageId, rootId), (page) =>
    page ? update(page) : create ? update(EMPTY_THREAD) : page,
  );
}

/**
 * Свежие версии на место загруженных — после правки или по сигналу.
 * Локальные превью переживают замену, только если вложения не менялись
 * (та же правка) или их передали явно.
 */
export function replaceComments(
  queryClient: QueryClient,
  messageId: string,
  fresh: Comment[],
  localPreviews: ReadonlyMap<string, string[]> = new Map(),
) {
  if (fresh.length === 0) return;

  const byId = new Map(fresh.map((comment) => [comment.id, comment]));

  updateAllComments(queryClient, messageId, (item) => {
    const next = byId.get(item.id);

    if (!next) return item;

    const previews =
      localPreviews.get(next.id) ?? (next.editedAt === item.editedAt ? item.localPreviews : undefined);

    return { ...toCommentItem(next), localPreviews: previews };
  });
}
