// Загруженные комментарии сообщения в кеше TanStack Query: самые новые
// первыми и курсор к следующей странице назад. Как история чата — одним
// списком, а не страницами: всё, что пришло в кеш за время догрузки, не
// теряется (см. `historyCache`).

import type { QueryClient } from '@tanstack/react-query';

import type { Comment } from '@/api/comments';
import { toCommentItem, type CommentItem } from '@/features/interactions/comments/commentItem';

export type CommentsPage = {
  /** Newest first — список, который их рисует, перевёрнут. */
  items: CommentItem[];
  /** `createdAt` самого старого загруженного, пока глубже есть что грузить. */
  nextCursor: string | null;
};

export function commentsQueryKey(messageId: string) {
  return ['comments', messageId] as const;
}

function byNewest(a: CommentItem, b: CommentItem): number {
  if (a.createdAt === b.createdAt) return 0;

  return a.createdAt > b.createdAt ? -1 : 1;
}

/** Вливает комментарии: известные остаются как есть (у своих там локальные превью), новые встают по времени. */
export function mergeComments(page: CommentsPage, incoming: Comment[]): CommentsPage {
  const known = new Set(page.items.map((item) => item.id));
  const added = incoming.filter((comment) => !known.has(comment.id)).map(toCommentItem);

  if (added.length === 0) return page;

  return { ...page, items: [...added, ...page.items].sort(byNewest) };
}

export function removeComments(page: CommentsPage, ids: ReadonlySet<string>): CommentsPage {
  const items = page.items.filter((item) => !ids.has(item.id));

  return items.length === page.items.length ? page : { ...page, items };
}

/**
 * Свежие версии на место загруженных — после правки. Локальные превью
 * переживают замену, только если их передали явно: вложения могли смениться.
 */
export function replaceComments(
  page: CommentsPage,
  fresh: Comment[],
  localPreviews: ReadonlyMap<string, string[]> = new Map(),
): CommentsPage {
  const byId = new Map(fresh.map((comment) => [comment.id, comment]));
  let changed = false;

  const items = page.items.map((item) => {
    const next = byId.get(item.id);

    if (!next) return item;

    changed = true;
    return { ...toCommentItem(next), localPreviews: localPreviews.get(next.id) };
  });

  return changed ? { ...page, items } : page;
}

export function readComments(queryClient: QueryClient, messageId: string): CommentsPage | undefined {
  return queryClient.getQueryData<CommentsPage>(commentsQueryKey(messageId));
}

/** Меняет загруженное; незагруженное не создаёт — пустой список соврал бы, что комментариев нет. */
export function updateComments(
  queryClient: QueryClient,
  messageId: string,
  update: (page: CommentsPage) => CommentsPage,
) {
  queryClient.setQueryData<CommentsPage>(commentsQueryKey(messageId), (page) =>
    page ? update(page) : page,
  );
}
