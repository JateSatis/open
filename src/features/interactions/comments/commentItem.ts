// Комментарий в том виде, в каком его рисует панель. Он нарочно совместим с
// `ChatMessage`: облачко, строка с жестами, меню, реакции, цитаты, правка и
// её плашка у комментариев те же, что у сообщений, — переиспользуются, а не
// копируются. Цитата комментария — комментарий того же треда: `messageId`
// цитаты здесь — id комментария. Островка и своих комментариев у
// комментария нет — эти поля всегда пустые.

import type { Comment, CommentAudience } from '@/api/comments';
import { NO_REACTIONS } from '@/api/reactionCounts';
import type { ChatMessage } from '@/features/chats/messages/types';

export type CommentItem = ChatMessage & {
  /** Сообщение, к которому комментарий. */
  messageId: string;
  audience: CommentAudience;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
  /** Корень треда; `null` — комментарий верхнеуровневый. */
  threadRootId: string | null;
  /** Сколько живых ответов в треде (у корня). */
  repliesCount: number;
  /** Удалённый корень с живыми ответами — на его месте заглушка. */
  deleted: boolean;
};

/**
 * Ключ ветки комментариев одного сообщения в общих клиентских хранилищах —
 * черновиках поля ввода и правках в полёте. У чатов там ключ — id чата; с
 * префиксом они не пересекаются.
 */
export function commentThreadKey(messageId: string): string {
  return `comments:${messageId}`;
}

export function toCommentItem(comment: Comment): CommentItem {
  return {
    id: comment.id,
    chatId: comment.chatId,
    messageId: comment.messageId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorAvatarUrl,
    audience: comment.audience,
    kind: comment.kind,
    text: comment.text,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    attachments: comment.attachments,
    replies: comment.replies,
    forward: null,
    reactions: comment.reactions,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    threadRootId: comment.threadRootId,
    repliesCount: comment.repliesCount,
    deleted: comment.deleted,
  };
}

/** Корень треда, на месте которого остаётся заглушка: ответы живы, содержимого нет. */
export function asDeletedRoot(item: CommentItem): CommentItem {
  return {
    ...item,
    deleted: true,
    authorId: null,
    authorName: null,
    authorAvatarUrl: null,
    kind: 'text',
    text: null,
    editedAt: null,
    attachments: [],
    replies: [],
    reactions: NO_REACTIONS,
    localPreviews: undefined,
  };
}

/** Тред, куда ляжет ответ на этот комментарий: у ответа — его корень, у корня — он сам. */
export function threadOf(item: Pick<CommentItem, 'id' | 'threadRootId'>): string {
  return item.threadRootId ?? item.id;
}

/**
 * Цитаты, которые стоит показать в облачке. Ответ только на корень — это
 * просто ответ в треде, и цитата корня ничего не добавляет: тред и так его.
 */
export function visibleQuotes(item: CommentItem): CommentItem['replies'] {
  const [only, ...rest] = item.replies;

  if (only && rest.length === 0 && item.threadRootId && only.messageId === item.threadRootId) {
    return [];
  }

  return item.replies;
}
