// Оптимистичные правки сохранённого: одна запись лежит сразу в нескольких
// кешах — страницы «Все», «Посмотреть позже», закрепы и счётчик в «Чатах», —
// и меняется во всех разом, чтобы вкладки не расходились.

import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { SavedMessage, SavedPage, SavedPin, WatchLaterPage } from '@/api/saved';
import {
  savedMessagesQueryKey,
  savedPinsQueryKey,
  savedSummaryQueryKey,
  savedWatchLaterQueryKey,
} from '@/features/saved/keys';

type AllData = InfiniteData<SavedPage, unknown>;
type LaterData = InfiniteData<WatchLaterPage, unknown>;

/** Правка записи: новая версия или `null` — записи больше нет. */
export type SavedPatch = (saved: SavedMessage) => SavedMessage | null;

function isPending(saved: SavedMessage | null | undefined): boolean {
  return Boolean(saved && saved.watchLaterAt !== null && saved.watchDoneAt === null);
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

  // Каждая запись правится один раз, даже если она в двух кешах.
  const apply = (saved: SavedMessage): SavedMessage | null => {
    if (!wanted.has(saved.id)) return saved;
    if (after.has(saved.id)) return after.get(saved.id) ?? null;

    const next = patch(saved);

    before.set(saved.id, saved);
    after.set(saved.id, next);
    return next;
  };

  queryClient.setQueryData<AllData>(savedMessagesQueryKey, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((saved) => apply(saved) ?? []),
          })),
        }
      : data,
  );

  queryClient.setQueryData<LaterData>(savedWatchLaterQueryKey, (data) => {
    if (!data) return data;

    const present = new Set<string>();
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((saved) => {
        present.add(saved.id);
        const next = apply(saved);

        return next && next.watchLaterAt !== null ? [next] : [];
      }),
    }));
    // Только что попавшие в список дел — в первую страницу: место им наведёт
    // порядок вкладки.
    const added = [...after.values()].filter(
      (saved): saved is SavedMessage =>
        saved !== null && saved.watchLaterAt !== null && !present.has(saved.id),
    );

    if (added.length > 0 && pages[0])
      pages[0] = { ...pages[0], items: [...added, ...pages[0].items] };

    return { ...data, pages };
  });

  queryClient.setQueryData<SavedPin[]>(savedPinsQueryKey, (pins) => {
    if (!pins) return pins;

    const kept = pins.filter((pin) => {
      if (!after.has(pin.id)) return true;

      return after.get(pin.id)?.pinnedAt != null;
    });
    // Новый закреп — последним: порядок по времени закрепления.
    const fresh = [...after.values()].filter(
      (saved): saved is SavedMessage =>
        saved !== null && saved.pinnedAt !== null && !pins.some((pin) => pin.id === saved.id),
    );

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
  queryClient.setQueryData<LaterData>(savedWatchLaterQueryKey, (data) => {
    if (!data || data.pages.some((page) => page.items.some((item) => item.id === saved.id)))
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

/** Запись из любого загруженного списка. */
export function findSaved(queryClient: QueryClient, id: string): SavedMessage | undefined {
  const all = queryClient.getQueryData<AllData>(savedMessagesQueryKey);
  const later = queryClient.getQueryData<LaterData>(savedWatchLaterQueryKey);

  for (const page of [...(all?.pages ?? []), ...(later?.pages ?? [])]) {
    const found = page.items.find((saved) => saved.id === id);

    if (found) return found;
  }

  return undefined;
}
