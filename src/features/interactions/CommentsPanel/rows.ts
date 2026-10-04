// Строки списка комментариев. Верхнеуровневый комментарий — одна строка;
// раскрытый тред раскладывается на строки ответов, как островок пересылки в
// переписке: длинный тред не становится одной гигантской строкой, список
// виртуализирует ответы по одному, а прыжок к ответу — это прыжок к его
// строке.

import type { CommentItem } from '@/features/interactions/comments/commentItem';

/** Строка внутри раскрытого треда: фон треда скругляется у первой и последней. */
export type ThreadPlace = { rootId: string; first: boolean; last: boolean };

export type CommentRow =
  | {
      type: 'comment';
      key: string;
      comment: CommentItem;
      /** Строка раскрытого треда; `null` — тред закрыт или это не тред. */
      thread: ThreadPlace | null;
      /** У корня — сколько ответов на кнопке треда; у ответа — 0. */
      replies: number;
    }
  | { type: 'thread-gap'; key: string; rootId: string; hidden: number; thread: ThreadPlace }
  | { type: 'thread-loading'; key: string; rootId: string; thread: ThreadPlace };

export type OpenThread = {
  rootId: string;
  head: CommentItem[];
  tail: CommentItem[];
  /** Свои неотправленные ответы — в самом конце. */
  pending: CommentItem[];
  hasGap: boolean;
  isLoading: boolean;
};

export function gapKey(rootId: string): string {
  return `${rootId}/gap`;
}

function loadingKey(rootId: string): string {
  return `${rootId}/loading`;
}

const place = (rootId: string): ThreadPlace => ({ rootId, first: false, last: false });

/** Строки треда под корнем, без самого корня. */
function threadRows(root: CommentItem, open: OpenThread): CommentRow[] {
  const rows: CommentRow[] = [];
  const reply = (comment: CommentItem): CommentRow => ({
    type: 'comment',
    key: comment.id,
    comment,
    thread: place(root.id),
    replies: 0,
  });

  if (open.isLoading) {
    rows.push({ type: 'thread-loading', key: loadingKey(root.id), rootId: root.id, thread: place(root.id) });
  } else {
    rows.push(...open.head.map(reply));

    if (open.hasGap) {
      const loaded = open.head.length + open.tail.length;

      rows.push({
        type: 'thread-gap',
        key: gapKey(root.id),
        rootId: root.id,
        // Число у корня может отставать от догруженного — «ещё» всегда хоть один.
        hidden: Math.max(1, root.repliesCount - loaded),
        thread: place(root.id),
      });
    }

    rows.push(...open.tail.map(reply));
  }

  const known = new Set(rows.map((row) => row.key));

  rows.push(...open.pending.filter((comment) => !known.has(comment.id)).map(reply));

  return rows;
}

/** Фон треда скругляется сверху у корня и снизу у последней строки. */
function withEnds(rows: CommentRow[]): CommentRow[] {
  return rows.map((row, index) => {
    if (!row.thread) return row;

    const first = index === 0;
    const last = index === rows.length - 1;

    return first || last ? { ...row, thread: { ...row.thread, first, last } } : row;
  });
}

/**
 * Список целиком: верх в порядке экрана, под раскрытым корнем — его тред.
 * Ответы в треде — хронологически, начало, разрыв «показать ещё», за ним —
 * загруженный хвост и свои неотправленные.
 */
export function buildCommentRows(
  roots: CommentItem[],
  open: OpenThread | null,
  pendingCount: (rootId: string) => number = () => 0,
): CommentRow[] {
  const rows: CommentRow[] = [];

  for (const root of roots) {
    const isOpen = open?.rootId === root.id;
    const replies = root.repliesCount + pendingCount(root.id);

    // Удалённый корень без ответов показывать незачем.
    if (root.deleted && replies === 0) continue;

    const rootRow: CommentRow = {
      type: 'comment',
      key: root.id,
      comment: root,
      thread: isOpen ? place(root.id) : null,
      replies,
    };

    if (!isOpen || !open) {
      rows.push(rootRow);
      continue;
    }

    rows.push(...withEnds([rootRow, ...threadRows(root, open)]));
  }

  return rows;
}

/** Где в строках раскрытый тред: строка корня и последняя строка треда. */
export function threadBounds(
  rows: CommentRow[],
  rootId: string | null,
): { first: number; last: number } | null {
  if (!rootId) return null;

  const first = rows.findIndex((row) => row.thread?.rootId === rootId && row.thread.first);

  if (first === -1) return null;

  let last = first;

  while (last + 1 < rows.length && rows[last + 1].thread?.rootId === rootId) last += 1;

  return { first, last };
}
