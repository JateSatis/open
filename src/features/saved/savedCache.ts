// Оптимистичные правки сохранённого: одна запись лежит сразу в нескольких
// кешах — страницы «Все», «Посмотреть позже», закрепы и счётчик в «Чатах», —
// и меняется во всех разом, чтобы вкладки не расходились. Каждый список
// бывает и без фильтра, и под фильтром (ключ фильтра — третьим элементом):
// правка идёт во все. Запись, переставшая подходить под фильтр (сняли тег),
// из отфильтрованного списка уходит; попавшую в него впервые подбирает
// перечитывание после ответа сервера (`refreshFiltered`): подходит ли она,
// решает база, а раньше ответа она отдала бы прежнее состояние.

import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

import type {
  SavedFilterInput,
  SavedMessage,
  SavedPage,
  SavedPin,
  SavedQuote,
  WatchLaterPage,
} from '@/api/saved';
import {
  savedMessagesQueryKey,
  savedPinsQueryKey,
  savedSummaryQueryKey,
  savedWatchLaterQueryKey,
} from '@/features/saved/keys';
import { filterOfKey, tagsStillMatch } from '@/features/saved/savedFilters';

type AllData = InfiniteData<SavedPage, unknown>;
type LaterData = InfiniteData<WatchLaterPage, unknown>;

/** Правка записи: новая версия или `null` — записи больше нет. */
export type SavedPatch = (saved: SavedMessage) => SavedMessage | null;

function isPending(saved: SavedMessage | null | undefined): boolean {
  return Boolean(saved && saved.watchLaterAt !== null && saved.watchDoneAt === null);
}

/**
 * Каждый загруженный кеш списка: без фильтра и под каждым фильтром. `filter`
 * — `null` у списка без фильтра.
 */
function eachList<T>(
  queryClient: QueryClient,
  prefix: QueryKey,
  update: (data: T, filter: SavedFilterInput | null) => T,
) {
  for (const [key, data] of queryClient.getQueriesData<T>({ queryKey: prefix })) {
    if (data === undefined) continue;

    const filter = key.length > prefix.length ? filterOfKey(key[prefix.length]) : null;

    queryClient.setQueryData<T>(key, update(data, filter));
  }
}

const FILTERED_PREFIXES: readonly QueryKey[] = [
  savedMessagesQueryKey,
  savedWatchLaterQueryKey,
  savedPinsQueryKey,
];

/**
 * Перечитать списки под фильтрами — после того как правка дошла до сервера
 * или откатилась: новую подходящую запись (и не вернувшуюся откатом) знает
 * только база.
 */
export function refreshFiltered(queryClient: QueryClient) {
  for (const prefix of FILTERED_PREFIXES) {
    void queryClient.invalidateQueries({
      queryKey: prefix,
      predicate: (query) => query.queryKey.length > prefix.length,
    });
  }
}

/**
 * Порядок «Посмотреть позже»: активные новыми вперёд, затем выполненные —
 * последнее отмеченное первым. Тот же, что у базы (`list_saved_watch_later`).
 */
export function watchLaterOrder(a: SavedMessage, b: SavedMessage): number {
  const aDone = a.watchDoneAt !== null;
  const bDone = b.watchDoneAt !== null;

  if (aDone !== bDone) return aDone ? 1 : -1;

  const aAt = (aDone ? a.watchDoneAt : a.watchLaterAt) ?? '';
  const bAt = (bDone ? b.watchDoneAt : b.watchLaterAt) ?? '';

  if (aAt !== bAt) return aAt < bAt ? 1 : -1;

  return b.seq - a.seq;
}

/** Миниатюра закрепа — как у базы (`list_saved_pins`): фото или постер первого вложения. */
export function pinOf(saved: SavedMessage): SavedPin {
  const first = saved.attachments.find(
    (attachment) => !attachment.hidden && !attachment.popDeleted,
  );
  const thumbnailUrl = !first
    ? null
    : first.popId || first.mimeType?.startsWith('video/')
      ? first.posterUrl
      : first.mimeType?.startsWith('audio/')
        ? null
        : first.url;

  return { id: saved.id, seq: saved.seq, kind: saved.kind, text: saved.text, thumbnailUrl };
}

/**
 * Меняет записи `ids` во всех кешах сохранённого. Отдаёт прежние версии —
 * по ним правка откатывается (`rollbackSaved`).
 */
export function patchSaved(
  queryClient: QueryClient,
  ids: readonly string[],
  patch: SavedPatch,
): Map<string, SavedMessage> {
  const wanted = new Set(ids);
  const before = new Map<string, SavedMessage>();
  const after = new Map<string, SavedMessage | null>();

  // Каждая запись правится один раз, даже если она в нескольких кешах.
  const apply = (saved: SavedMessage): SavedMessage | null => {
    if (!wanted.has(saved.id)) return saved;
    if (after.has(saved.id)) return after.get(saved.id) ?? null;

    const next = patch(saved);

    before.set(saved.id, saved);
    after.set(saved.id, next);
    return next;
  };
  const kept = (saved: SavedMessage | null, filter: SavedFilterInput | null) =>
    saved !== null && tagsStillMatch(saved.tagIds, filter) ? [saved] : [];

  eachList<AllData>(queryClient, savedMessagesQueryKey, (data, filter) => ({
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((saved) => kept(apply(saved), filter)),
    })),
  }));

  // Только что попавшие в список дел — их ищем после правки всех кешей «Все».
  const laterQueries = queryClient.getQueriesData<LaterData>({ queryKey: savedWatchLaterQueryKey });

  // Записи, которых нет ни в одном «Все» (вкладка «Посмотреть позже» до них
  // догружена дальше), правятся здесь же.
  for (const [, data] of laterQueries) data?.pages.forEach((page) => page.items.forEach(apply));

  eachList<LaterData>(queryClient, savedWatchLaterQueryKey, (data, filter) => {
    const present = new Set<string>();
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((saved) => {
        present.add(saved.id);
        const next = apply(saved);

        return next && next.watchLaterAt !== null ? kept(next, filter) : [];
      }),
    }));
    const added = [...after.values()].filter(
      (saved): saved is SavedMessage =>
        saved !== null && saved.watchLaterAt !== null && !present.has(saved.id),
    );

    if (added.length === 0) return { ...data, pages };

    // Подходит ли под фильтр новая запись вкладки, знает база (`refreshFiltered`).
    if (filter) return { ...data, pages };

    // В первую страницу: место им наведёт порядок вкладки.
    if (pages[0]) pages[0] = { ...pages[0], items: [...added, ...pages[0].items] };

    return { ...data, pages };
  });

  eachList<SavedPin[]>(queryClient, savedPinsQueryKey, (pins, filter) => {
    const kept = pins.filter((pin) => {
      if (!after.has(pin.id)) return true;

      const next = after.get(pin.id);

      return next?.pinnedAt != null && tagsStillMatch(next.tagIds, filter);
    });
    // Новый закреп — последним: порядок по времени закрепления.
    const fresh = [...after.values()].filter(
      (saved): saved is SavedMessage =>
        saved !== null && saved.pinnedAt !== null && !pins.some((pin) => pin.id === saved.id),
    );

    if (filter) return kept;

    return [...kept, ...fresh.map(pinOf)];
  });

  let delta = 0;

  for (const [id, previous] of before)
    delta += Number(isPending(after.get(id))) - Number(isPending(previous));

  bumpPending(queryClient, delta);

  return before;
}

/** Счётчик «Посмотреть позже» в «Чатах» — на `delta`. */
export function bumpPending(queryClient: QueryClient, delta: number) {
  if (delta === 0) return;

  queryClient.setQueryData<{ watchLaterPending: number }>(savedSummaryQueryKey, (summary) =>
    summary ? { watchLaterPending: Math.max(0, summary.watchLaterPending + delta) } : summary,
  );
}

/**
 * Запись снова в «Посмотреть позже» — и в загруженном списке вкладки, даже
 * если «Все» до неё не догружены («Вернуть» после свайпа).
 */
export function putInWatchLater(queryClient: QueryClient, saved: SavedMessage) {
  eachList<LaterData>(queryClient, savedWatchLaterQueryKey, (data, filter) => {
    if (filter || data.pages.some((page) => page.items.some((item) => item.id === saved.id)))
      return data;

    const [first, ...rest] = data.pages;

    return first
      ? { ...data, pages: [{ ...first, items: [saved, ...first.items] }, ...rest] }
      : data;
  });
}

/** Возвращает прежние версии записей после неудачной правки. */
export function rollbackSaved(queryClient: QueryClient, before: Map<string, SavedMessage>) {
  patchSaved(queryClient, [...before.keys()], (saved) => before.get(saved.id) ?? saved);
}

/** Живая цитата заметки — запись, как её видно в ответе. */
export type LiveSavedQuote = Extract<SavedQuote, { savedId: string }>;

/**
 * Цитаты заметок во всех списках — заново: цитируемую удалили или
 * исправили. `change` отвечает новой цитатой или той же.
 */
export function patchQuotes(
  queryClient: QueryClient,
  change: (quote: LiveSavedQuote) => SavedQuote,
) {
  const apply = (saved: SavedMessage): SavedMessage => {
    if (saved.replies.length === 0) return saved;

    let changed = false;
    const replies = saved.replies.map((quote) => {
      if (quote.savedId === null) return quote;

      const next = change(quote);

      if (next !== quote) changed = true;

      return next;
    });

    return changed ? { ...saved, replies } : saved;
  };
  const pages = <P extends { items: SavedMessage[] }>(data: InfiniteData<P, unknown>) => ({
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: page.items.map(apply) })),
  });

  eachList<AllData>(queryClient, savedMessagesQueryKey, pages);
  eachList<LaterData>(queryClient, savedWatchLaterQueryKey, pages);
}

/** Запись из любого загруженного списка. */
export function findSaved(queryClient: QueryClient, id: string): SavedMessage | undefined {
  const lists = [
    ...queryClient.getQueriesData<AllData>({ queryKey: savedMessagesQueryKey }),
    ...queryClient.getQueriesData<LaterData>({ queryKey: savedWatchLaterQueryKey }),
  ];

  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((saved) => saved.id === id);

      if (found) return found;
    }
  }

  return undefined;
}
