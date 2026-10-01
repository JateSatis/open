// Комментарий в том виде, в каком его рисует панель. Он нарочно совместим с
// `ChatMessage`: облачко, строка с жестами, меню, реакции, цитаты, правка и
// её плашка у комментариев те же, что у сообщений, — переиспользуются, а не
// копируются. Цитата комментария — комментарий той же ветки: `messageId`
// цитаты здесь — id комментария. Пересылки и своих комментариев у
// комментария нет — эти поля всегда пустые.

import type { Comment, CommentAudience } from '@/api/comments';
import type { ChatMessage } from '@/features/chats/messages/types';

export type CommentItem = ChatMessage & {
  /** Сообщение, к которому комментарий. */
  messageId: string;
  audience: CommentAudience;
  /** `null` — аккаунт автора удалён. */
  authorName: string | null;
  authorAvatarUrl: string | null;
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
    status: 'sent',
  };
}
