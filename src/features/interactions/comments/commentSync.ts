// Как комментарии догоняют базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS, так что
// поддельное событие ничего не добавит и ничего не уберёт.
//
// Верх по рангу на глазах не меняется: чужой новый верхнеуровневый комментарий
// появится при следующем открытии панели, а счётчики, правки и удаления
// ложатся на место. Новый ответ — в конец треда, если тред дочитан до конца;
// иначе он за разрывом, и его догрузит «Показать ещё».

import type { QueryClient } from '@tanstack/react-query';

import {
  listCommentReactions,
  listCommentsByIds,
  listThreadReplies,
  listThreadRoots,
  type Comment,
} from '@/api/comments';
import {
  asDeletedRoot,
  toCommentItem,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import {
  EMPTY_THREAD,
  addToThread,
  appendThreadHead,
  isThreadComplete,
  loadedComments,
  loadedThreads,
  pinRoot,
  readThread,
  replaceComments,
  rootsPageOf,
  updateAllComments,
  updateRoots,
  updateThread,
  type RootsPage,
  type ThreadPage,
} from '@/features/interactions/comments/commentsCache';

/** Столько id сверяется одним запросом. */
const MAX_IDS = 500;

/** Первая страница верха — свежий ранг. */
export async function loadRoots(messageId: string): Promise<RootsPage> {
  return rootsPageOf(await listThreadRoots(messageId));
}

/**
 * Начало треда. Своё, что уже лежит за разрывом (только что отправленный
 * ответ, цель прыжка), не теряется.
 */
export async function loadThread(
  queryClient: QueryClient,
  messageId: string,
  rootId: string,
): Promise<ThreadPage> {
  const page = await listThreadReplies(rootId);
  const tail = readThread(queryClient, messageId, rootId)?.tail ?? [];

  return appendThreadHead({ ...EMPTY_THREAD, tail }, page.items, page.nextCursor);
}

/** Ответ — в конец своего треда, если тред дочитан; свой верхнеуровневый — наверх. */
function placeAdded(queryClient: QueryClient, messageId: string, me: string | null, comment: Comment) {
  const item = toCommentItem(comment);

  if (comment.threadRootId) {
    const thread = readThread(queryClient, messageId, comment.threadRootId);

    if (isThreadComplete(thread)) {
      updateThread(queryClient, messageId, comment.threadRootId, (page) => addToThread(page, item));
    }

    return;
  }

  // Свой — отправленный с другого устройства. Чужой новый на глазах не
  // появляется: порядок не прыгает, он будет при следующем открытии.
  if (me && comment.authorId === me) {
    updateRoots(queryClient, messageId, (page) =>
      [...page.pinned, ...page.items].some((other) => other.id === item.id)
        ? page
        : pinRoot(page, item),
    );
  }
}

/**
 * Удалённые: корень с живыми ответами становится заглушкой, остальное уходит
 * с экрана. Ответы удалённых правят число у корня-заглушки здесь же — свежего
 * числа у удалённого база не отдаёт.
 */
function applyGone(
  queryClient: QueryClient,
  messageId: string,
  gone: CommentItem[],
  addedReplies: Map<string, number>,
) {
  if (gone.length === 0 && addedReplies.size === 0) return;

  const goneIds = new Set(gone.map((item) => item.id));
  const shift = new Map(addedReplies);

  for (const item of gone) {
    if (item.threadRootId) shift.set(item.threadRootId, (shift.get(item.threadRootId) ?? 0) - 1);
  }

  updateAllComments(queryClient, messageId, (item) => {
    if (goneIds.has(item.id)) {
      return !item.threadRootId && item.repliesCount > 0 ? asDeletedRoot(item) : null;
    }

    const delta = item.deleted ? (shift.get(item.id) ?? 0) : 0;

    if (delta === 0) return item;

    const repliesCount = item.repliesCount + delta;

    return repliesCount > 0 ? { ...item, repliesCount } : null;
  });
}

/**
 * По сигналам Realtime: `added` — появились, `changed` — правили или удалили.
 * Одним проходом на пачку событий: строки по id одним запросом, корни их
 * тредов — вторым (у корня изменилось число ответов).
 */
export async function syncComments(
  queryClient: QueryClient,
  messageId: string,
  me: string | null,
  { added, changed }: { added: string[]; changed: string[] },
): Promise<void> {
  const loaded = loadedComments(queryClient, messageId);
  const known = changed.filter((id) => loaded.has(id));
  const ids = [...new Set([...added, ...known])].slice(0, MAX_IDS);

  if (ids.length === 0) return;

  const fresh = await listCommentsByIds(ids);
  const alive = new Set(fresh.map((comment) => comment.id));
  const addedSet = new Set(added);
  const roots = new Set<string>();

  for (const comment of fresh) {
    if (comment.threadRootId) roots.add(comment.threadRootId);
  }

  for (const id of known) {
    const root = loaded.get(id)?.threadRootId;

    if (root) roots.add(root);
  }

  const rootIds = [...roots].filter((id) => loaded.has(id));
  const freshRoots = rootIds.length > 0 ? await listCommentsByIds(rootIds) : [];
  const now = loadedComments(queryClient, messageId);
  const gone = known.filter((id) => !alive.has(id)).flatMap((id) => now.get(id) ?? []);
  const addedReplies = new Map<string, number>();

  for (const comment of fresh) {
    if (!addedSet.has(comment.id) || now.has(comment.id)) continue;

    if (comment.threadRootId) {
      addedReplies.set(comment.threadRootId, (addedReplies.get(comment.threadRootId) ?? 0) + 1);
    }

    placeAdded(queryClient, messageId, me, comment);
  }

  replaceComments(
    queryClient,
    messageId,
    [...fresh.filter((comment) => now.has(comment.id)), ...freshRoots],
  );
  applyGone(queryClient, messageId, gone, addedReplies);
}

/** Свежие счётчики реакций этих комментариев — по сигналу канала, пачкой. */
export async function syncCommentReactions(
  queryClient: QueryClient,
  messageId: string,
  ids: string[],
): Promise<void> {
  const fresh = await listCommentReactions(ids);
  const byId = new Map(fresh.map((row) => [row.id, row.reactions]));

  updateAllComments(queryClient, messageId, (item) => {
    const reactions = byId.get(item.id);

    return reactions ? { ...item, reactions } : item;
  });
}

/**
 * После обрыва канала: сверка всего загруженного (правки, удаления,
 * счётчики) и хвосты дочитанных тредов. Порядок верха не трогается.
 */
export async function resyncComments(
  queryClient: QueryClient,
  messageId: string,
  me: string | null,
): Promise<void> {
  const loaded = [...loadedComments(queryClient, messageId).keys()];
  const threads = [...loadedThreads(queryClient, messageId)].filter(([, page]) =>
    isThreadComplete(page),
  );

  await Promise.all([
    syncComments(queryClient, messageId, me, { added: [], changed: loaded }),
    ...threads.map(async ([rootId, page]) => {
      const last = page.head[page.head.length - 1];
      const newer = await listThreadReplies(rootId, { cursor: last?.createdAt });

      for (const comment of newer.items) placeAdded(queryClient, messageId, me, comment);
    }),
  ]);
}
