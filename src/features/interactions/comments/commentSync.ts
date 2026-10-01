// Как комментарии догоняют базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS, так что
// поддельное событие ничего не добавит и ничего не уберёт.

import type { QueryClient } from '@tanstack/react-query';

import {
  COMMENT_PAGE_SIZE,
  listCommentReactions,
  listComments,
  listCommentsByIds,
  listCommentsSince,
  type Comment,
} from '@/api/comments';
import { toCommentItem } from '@/features/interactions/comments/commentItem';
import {
  commentsQueryKey,
  mergeComments,
  readComments,
  removeComments,
  replaceComments,
  updateComments,
  type CommentsPage,
} from '@/features/interactions/comments/commentsCache';

/** Сколько страниц новых дочитывать, прежде чем начать заново. */
const MAX_CATCH_UP_PAGES = 5;
/** Столько id сверяется одним запросом. */
const MAX_IDS = 500;

async function firstPage(messageId: string): Promise<CommentsPage> {
  const page = await listComments(messageId);

  return { items: page.items.map(toCommentItem), nextCursor: page.nextCursor };
}

/** Пришедшие после `since`. `null` — пропущено слишком много, дешевле начать заново. */
async function fetchNewer(messageId: string, since: string): Promise<Comment[] | null> {
  const newer: Comment[] = [];
  let cursor = since;

  for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
    const batch = await listCommentsSince(messageId, cursor);

    newer.push(...batch);

    if (batch.length < COMMENT_PAGE_SIZE) return newer;

    cursor = batch[batch.length - 1].createdAt;
  }

  return null;
}

/**
 * Свежие версии загруженных `ids`: пришедшее правлено, не пришедшее —
 * удалено (удалённого база не отдаёт).
 */
function applyFresh(page: CommentsPage, ids: string[], fresh: Comment[]): CommentsPage {
  const alive = new Set(fresh.map((comment) => comment.id));
  const gone = new Set(ids.filter((id) => !alive.has(id)));
  const stale = fresh.filter((comment) => {
    const known = page.items.find((item) => item.id === comment.id);

    // Правка или реакции, пропущенные, пока канала не было.
    return (
      known &&
      (known.editedAt !== comment.editedAt ||
        JSON.stringify(known.reactions) !== JSON.stringify(comment.reactions))
    );
  });

  return replaceComments(removeComments(page, gone), stale);
}

/**
 * Загрузка для кеша запросов. Первый раз — первая страница. Потом —
 * дочитывание: новое после самого свежего и сверка загруженного (правки и
 * удаления), без перезагрузки — догруженное глубже не выбрасывается.
 */
export async function loadComments(
  queryClient: QueryClient,
  messageId: string,
): Promise<CommentsPage> {
  const cached = readComments(queryClient, messageId);
  const since = cached?.items[0]?.createdAt;

  if (!cached || !since) return firstPage(messageId);

  const ids = cached.items.slice(0, MAX_IDS).map((item) => item.id);
  const [newer, fresh] = await Promise.all([
    fetchNewer(messageId, since),
    listCommentsByIds(ids),
  ]);

  if (newer === null) return firstPage(messageId);

  const latest = readComments(queryClient, messageId) ?? cached;

  return mergeComments(applyFresh(latest, ids, fresh), newer);
}

/** Свежие счётчики реакций этих комментариев — по сигналу канала, пачкой. */
export async function syncCommentReactions(
  queryClient: QueryClient,
  messageId: string,
  ids: string[],
): Promise<void> {
  const fresh = await listCommentReactions(ids);
  const byId = new Map(fresh.map((row) => [row.id, row.reactions]));

  updateComments(queryClient, messageId, (page) => {
    let changed = false;
    const items = page.items.map((item) => {
      const reactions = byId.get(item.id);

      if (!reactions) return item;

      changed = true;
      return { ...item, reactions };
    });

    return changed ? { ...page, items } : page;
  });
}

/**
 * По сигналам Realtime: `pullNewer` — пришло новое; `ids` — эти правили или
 * удалили. Одним проходом на пачку событий.
 */
export async function syncComments(
  queryClient: QueryClient,
  messageId: string,
  { pullNewer, ids }: { pullNewer: boolean; ids: string[] },
): Promise<void> {
  const page = readComments(queryClient, messageId);

  if (!page) return;

  const loaded = new Set(page.items.map((item) => item.id));
  const known = ids.filter((id) => loaded.has(id)).slice(0, MAX_IDS);
  const since = page.items[0]?.createdAt;

  const [newer, fresh] = await Promise.all([
    pullNewer
      ? since
        ? fetchNewer(messageId, since)
        : listComments(messageId).then((first) => [...first.items].reverse())
      : Promise.resolve([]),
    listCommentsByIds(known),
  ]);

  updateComments(queryClient, messageId, (current) =>
    mergeComments(applyFresh(current, known, fresh), newer ?? []),
  );

  // Новых больше, чем имеет смысл дочитывать по страницам, — начать заново.
  if (newer === null) void queryClient.invalidateQueries({ queryKey: commentsQueryKey(messageId) });
}
