// Строки двух списков шита комментариев. Основной список — верхнеуровневые
// комментарии, по одной строке, тред под ними не раскрывается. Окно треда —
// свой список: корень, под ним ответы по одному, как островок пересылки в
// переписке. Длинный тред не становится одной гигантской строкой, список
// виртуализирует ответы, а прыжок к ответу — это прыжок к его строке.

import type { CommentItem } from '@/features/interactions/comments/commentItem';

export type CommentRow =
  | {
      type: 'comment';
      key: string;
      comment: CommentItem;
      /** Корень в окне треда: на фоне островка. */
      threadRoot: boolean;
      /** В основном списке — число на кнопке «N ответов»; 0 — кнопки нет. */
      replies: number;
    }
  | { type: 'thread-gap'; key: string; rootId: string; hidden: number }
  | { type: 'thread-loading'; key: string; rootId: string }
  | { type: 'thread-failed'; key: string; rootId: string };

export type OpenThread = {
  /** Корень; `null` — его ещё нет среди загруженных. */
  root: CommentItem | null;
  rootId: string;
  head: CommentItem[];
  tail: CommentItem[];
  /** Свои неотправленные ответы — в самом конце. */
  pending: CommentItem[];
  hasGap: boolean;
  isLoading: boolean;
  /** Начало не загрузилось — вместо колеса предложить повтор. */
  failed?: boolean;
};

export function gapKey(rootId: string): string {
  return `${rootId}/gap`;
}

function loadingKey(rootId: string): string {
  return `${rootId}/loading`;
}

/** Основной список: верх в порядке экрана, с числом ответов у каждого. */
export function buildCommentRows(
  roots: CommentItem[],
  pendingCount: (rootId: string) => number = () => 0,
): CommentRow[] {
  const rows: CommentRow[] = [];

  for (const root of roots) {
    const replies = root.repliesCount + pendingCount(root.id);

    // Удалённый корень без ответов показывать незачем.
    if (root.deleted && replies === 0) continue;

    rows.push({ type: 'comment', key: root.id, comment: root, threadRoot: false, replies });
  }

  return rows;
}

/**
 * Окно треда: корень, под ним ответы хронологически — начало, разрыв
 * «показать ещё», загруженный хвост и свои неотправленные.
 */
export function buildThreadRows(open: OpenThread): CommentRow[] {
  const { root, rootId } = open;
  const rows: CommentRow[] = [];
  const reply = (comment: CommentItem): CommentRow => ({
    type: 'comment',
    key: comment.id,
    comment,
    threadRoot: false,
    replies: 0,
  });

  if (root) rows.push({ type: 'comment', key: root.id, comment: root, threadRoot: true, replies: 0 });

  if (open.isLoading) {
    // Начало ещё грузится, а хвост уже есть — например, ответ, к которому пришли.
    rows.push(
      open.failed
        ? { type: 'thread-failed', key: loadingKey(rootId), rootId }
        : { type: 'thread-loading', key: loadingKey(rootId), rootId },
    );
    rows.push(...open.tail.map(reply));
  } else {
    rows.push(...open.head.map(reply));

    if (open.hasGap) {
      const loaded = open.head.length + open.tail.length;

      rows.push({
        type: 'thread-gap',
        key: gapKey(rootId),
        rootId,
        // Число у корня может отставать от догруженного — «ещё» всегда хоть один.
        hidden: Math.max(1, (root?.repliesCount ?? 0) - loaded),
      });
    }

    rows.push(...open.tail.map(reply));
  }

  const known = new Set(rows.map((row) => row.key));

  rows.push(...open.pending.filter((comment) => !known.has(comment.id)).map(reply));

  return rows;
}
