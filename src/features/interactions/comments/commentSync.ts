// Как комментарии догоняют базу. Payload событий Realtime — только сигнал:
// сами строки всегда читаются из Postgres, где видимость решает RLS, так что
// поддельное событие ничего не добавит и ничего не уберёт.
//
// Верх по рангу на глазах не меняется: чужой новый верхнеуровневый комментарий
// появится при следующем открытии панели, а счётчики, правки и удаления
// ложатся на место. Новый ответ — в конец треда, если тред дочитан до конца;
// иначе он за разрывом, и его догрузит «Показать ещё».

import type { QueryClient } from '@tanstack/react-query';

import { listMessageFragments, type Fragment } from '@/api/fragments';
import { fragmentInSet } from '@/features/chats/fragments/fragmentSets';
import { fragmentsKey, readMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import {
  getPinnedComment,
  listCommentReactions,
  listCommentsByIds,
  listCommentThreadReplies,
  listCommentThreadRoots,
  type Comment,
} from '@/api/comments';
import {
  asDeletedRoot,
  toCommentItem,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import {
  EMPTY_COMMENT_THREAD,
  addToCommentThread,
  appendCommentThreadHead,
  isCommentThreadComplete,
  loadedComments,
  loadedCommentThreads,
  raiseRoot,
  readCommentThread,
  rootsInOrder,
  setAuthorPin,
  replaceComments,
  rootsPageOf,
  scopesOf,
  updateAllComments,
  updateRoots,
  updateScopedRoots,
  updateCommentThread,
  type RootsPage,
  type RootsScope,
  type CommentThreadPage,
} from '@/features/interactions/comments/commentsCache';

/** Столько id сверяется одним запросом. */
const MAX_IDS = 500;

/**
 * Первая страница верха — свежий ранг — и закреп автора над ней. В боковой
 * панели — только корни фрагментов её набора, и закреп — только если
 * закреплён комментарий одного из них.
 */
export async function loadRoots(targetId: string, scope?: RootsScope): Promise<RootsPage> {
  const [page, pinned] = await Promise.all([
    scope ? listCommentThreadRoots(targetId, { set: scope.set }) : listCommentThreadRoots(targetId),
    scope ? getPinnedComment(targetId, scope.set) : getPinnedComment(targetId),
  ]);

  return scope ? { ...rootsPageOf(page, pinned), scope } : rootsPageOf(page, pinned);
}

type FragmentLookup = (fragmentId: string) => Fragment | null;

const NO_FRAGMENTS: FragmentLookup = () => null;

/**
 * Фрагменты новых комментариев — чтобы решить, входят ли они в набор
 * открытой боковой панели. Без панели не нужны вовсе; чего нет в кеше (чужой
 * новый фрагмент) — одним свежим списком на пачку.
 */
async function fragmentLookup(
  queryClient: QueryClient,
  messageId: string,
  comments: readonly Comment[],
): Promise<FragmentLookup> {
  const wanted = comments.flatMap((c) => (!c.commentThreadRootId && c.fragmentId ? [c.fragmentId] : []));

  if (wanted.length === 0 || scopesOf(queryClient, messageId).length === 0) return NO_FRAGMENTS;

  let fragments = readMessageFragments(queryClient, messageId) ?? [];

  if (wanted.some((id) => !fragments.some((f) => f.id === id))) {
    fragments =
      (await queryClient
        .fetchQuery({
          queryKey: fragmentsKey(messageId),
          queryFn: () => listMessageFragments(messageId),
          staleTime: 0,
        })
        .catch(() => undefined)) ?? fragments;
  }

  const byId = new Map(fragments.map((f) => [f.id, f]));

  return (id) => byId.get(id) ?? null;
}

/** Закреп сменился (сигнал канала или своё действие не прошло) — берём его из базы. */
export async function syncAuthorPin(queryClient: QueryClient, targetId: string): Promise<void> {
  const scopes = scopesOf(queryClient, targetId);
  const [fresh, scoped] = await Promise.all([
    getPinnedComment(targetId),
    Promise.all(scopes.map((scope) => getPinnedComment(targetId, scope.set))),
  ]);
  const byKey = new Map(scopes.map((scope, index) => [scope.key, scoped[index]]));

  updateRoots(queryClient, targetId, (page) =>
    setAuthorPin(page, fresh ? toCommentItem(fresh) : null),
  );
  updateScopedRoots(queryClient, targetId, (page, scope) => {
    const pinned = byKey.get(scope.key);

    return pinned === undefined ? page : setAuthorPin(page, pinned ? toCommentItem(pinned) : null);
  });
}

/**
 * Начало треда. Своё, что уже лежит за разрывом (только что отправленный
 * ответ, цель прыжка), не теряется.
 */
export async function loadCommentThread(
  queryClient: QueryClient,
  targetId: string,
  rootId: string,
): Promise<CommentThreadPage> {
  const page = await listCommentThreadReplies(rootId);
  const tail = readCommentThread(queryClient, targetId, rootId)?.tail ?? [];

  return appendCommentThreadHead({ ...EMPTY_COMMENT_THREAD, tail }, page.items, page.nextCursor);
}

/** Ответ — в конец своего треда, если тред дочитан; свой верхнеуровневый — наверх. */
function placeAdded(
  queryClient: QueryClient,
  targetId: string,
  me: string | null,
  comment: Comment,
  fragmentOf: FragmentLookup,
) {
  const item = toCommentItem(comment);

  if (comment.commentThreadRootId) {
    const commentThread = readCommentThread(queryClient, targetId, comment.commentThreadRootId);

    if (isCommentThreadComplete(commentThread)) {
      updateCommentThread(queryClient, targetId, comment.commentThreadRootId, (page) => addToCommentThread(page, item));
    }

    return;
  }

  // Свой — отправленный с другого устройства. Чужой новый на глазах не
  // появляется: порядок не прыгает, он будет при следующем открытии.
  if (me && comment.authorId === me) {
    updateRoots(queryClient, targetId, (page) =>
      rootsInOrder(page).some((other) => other.id === item.id) ? page : raiseRoot(page, item),
    );
  }

  // В боковой панели — и чужой: разговор о куске текста короткий, и новое
  // в нём видно сразу. Входит ли его фрагмент в набор — как решила бы база.
  if (comment.fragmentId) {
    const fragment = fragmentOf(comment.fragmentId);

    if (!fragment) return;

    updateScopedRoots(queryClient, targetId, (page, scope) =>
      !fragmentInSet(fragment, scope.set) ||
      rootsInOrder(page).some((other) => other.id === item.id)
        ? page
        : raiseRoot(page, item),
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
  targetId: string,
  gone: CommentItem[],
  addedReplies: Map<string, number>,
) {
  if (gone.length === 0 && addedReplies.size === 0) return;

  const goneIds = new Set(gone.map((item) => item.id));
  const shift = new Map(addedReplies);

  for (const item of gone) {
    if (item.commentThreadRootId) shift.set(item.commentThreadRootId, (shift.get(item.commentThreadRootId) ?? 0) - 1);
  }

  updateAllComments(queryClient, targetId, (item) => {
    if (goneIds.has(item.id)) {
      return !item.commentThreadRootId && item.repliesCount > 0 ? asDeletedRoot(item) : null;
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
  targetId: string,
  me: string | null,
  { added, changed }: { added: string[]; changed: string[] },
): Promise<void> {
  const loaded = loadedComments(queryClient, targetId);
  const known = changed.filter((id) => loaded.has(id));
  const ids = [...new Set([...added, ...known])].slice(0, MAX_IDS);

  if (ids.length === 0) return;

  const fresh = await listCommentsByIds(ids);
  const alive = new Set(fresh.map((comment) => comment.id));
  const addedSet = new Set(added);
  const roots = new Set<string>();

  for (const comment of fresh) {
    if (comment.commentThreadRootId) roots.add(comment.commentThreadRootId);
  }

  for (const id of known) {
    const root = loaded.get(id)?.commentThreadRootId;

    if (root) roots.add(root);
  }

  const rootIds = [...roots].filter((id) => loaded.has(id));
  const [freshRoots, fragmentOf] = await Promise.all([
    rootIds.length > 0 ? listCommentsByIds(rootIds) : Promise.resolve([]),
    fragmentLookup(
      queryClient,
      targetId,
      fresh.filter((comment) => addedSet.has(comment.id)),
    ),
  ]);
  const now = loadedComments(queryClient, targetId);
  const gone = known.filter((id) => !alive.has(id)).flatMap((id) => now.get(id) ?? []);
  const addedReplies = new Map<string, number>();

  for (const comment of fresh) {
    if (!addedSet.has(comment.id) || now.has(comment.id)) continue;

    if (comment.commentThreadRootId) {
      addedReplies.set(comment.commentThreadRootId, (addedReplies.get(comment.commentThreadRootId) ?? 0) + 1);
    }

    placeAdded(queryClient, targetId, me, comment, fragmentOf);
  }

  replaceComments(
    queryClient,
    targetId,
    [...fresh.filter((comment) => now.has(comment.id)), ...freshRoots],
  );
  applyGone(queryClient, targetId, gone, addedReplies);
}

/** Свежие счётчики реакций этих комментариев — по сигналу канала, пачкой. */
export async function syncCommentReactions(
  queryClient: QueryClient,
  targetId: string,
  ids: string[],
): Promise<void> {
  const fresh = await listCommentReactions(ids);
  const byId = new Map(fresh.map((row) => [row.id, row.reactions]));

  updateAllComments(queryClient, targetId, (item) => {
    const reactions = byId.get(item.id);

    return reactions ? { ...item, reactions } : item;
  });
}

/**
 * После обрыва канала: сверка всего загруженного (правки, удаления,
 * счётчики), закреп и хвосты дочитанных тредов. Порядок верха не трогается.
 */
export async function resyncComments(
  queryClient: QueryClient,
  targetId: string,
  me: string | null,
): Promise<void> {
  const loaded = [...loadedComments(queryClient, targetId).keys()];
  const commentThreads = [...loadedCommentThreads(queryClient, targetId)].filter(([, page]) =>
    isCommentThreadComplete(page),
  );

  await Promise.all([
    syncComments(queryClient, targetId, me, { added: [], changed: loaded }),
    syncAuthorPin(queryClient, targetId),
    ...commentThreads.map(async ([rootId, page]) => {
      const last = page.head[page.head.length - 1];
      const newer = await listCommentThreadReplies(rootId, { cursor: last?.createdAt });

      const fragmentOf = await fragmentLookup(queryClient, targetId, newer.items);

      for (const comment of newer.items) placeAdded(queryClient, targetId, me, comment, fragmentOf);
    }),
  ]);
}
