// Что можно сделать с комментарием из меню: то же, что с сообщением, кроме
// комментариев к нему. Закреп — свой: один на цель, только корень, и ставит
// его автор контента, а не участник. Видимость пункта — вежливость
// интерфейса: права всегда проверяет база.

import type { ContextMenuAction } from '@/features/chats/MessageContextMenu';
import { hasCopyableText, isEditable, isLocalMessage } from '@/features/chats/messageActions';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

export type CommentActionId =
  | 'retry'
  | 'reply'
  | 'copy'
  | 'edit'
  | 'pin'
  | 'unpin'
  | 'forward'
  | 'select'
  | 'delete';

export type CommentActionContext = {
  comment: CommentItem;
  isOwn: boolean;
  /** Сообщение, к которому комментарий, живо: у удалённого новых комментариев не принимают. */
  targetLive: boolean;
  /** Я автор контента, к которому комментарии, — мне можно закреплять. */
  canPin?: boolean;
  /** Этот комментарий закреплён автором контента. */
  isPinned?: boolean;
};

/** Закреп — только у отправленного корня живой цели и только автору контента. */
function pinnable({ comment, targetLive, canPin = false }: CommentActionContext): boolean {
  return canPin && targetLive && !comment.threadRootId && !comment.deleted && !isLocalMessage(comment);
}

type CommentAction = ContextMenuAction<CommentActionId> & {
  isVisible: (context: CommentActionContext) => boolean;
};

/** Пункты в том порядке, в котором их видит человек, — как у сообщения. */
export const COMMENT_ACTIONS: readonly CommentAction[] = [
  {
    id: 'retry',
    label: 'Повторить',
    isVisible: ({ comment }) => comment.status === 'failed',
  },
  {
    id: 'reply',
    label: 'Ответить',
    // Ответить на комментарий может любой — и посетитель тоже.
    isVisible: ({ comment, targetLive }) => targetLive && !isLocalMessage(comment),
  },
  {
    id: 'copy',
    label: 'Копировать',
    isVisible: ({ comment }) => !isLocalMessage(comment) && hasCopyableText(comment),
  },
  {
    id: 'edit',
    label: 'Изменить',
    isVisible: ({ comment, isOwn, targetLive }) => isOwn && targetLive && isEditable(comment),
  },
  {
    id: 'pin',
    label: 'Закрепить',
    isVisible: (context) => pinnable(context) && !context.isPinned,
  },
  {
    id: 'unpin',
    label: 'Открепить',
    isVisible: (context) => pinnable(context) && Boolean(context.isPinned),
  },
  {
    id: 'forward',
    label: 'Переслать',
    // Переслать в свой чат может любой — так разговор и расходится.
    isVisible: ({ comment }) => !isLocalMessage(comment),
  },
  {
    id: 'select',
    label: 'Выбрать',
    isVisible: ({ comment }) => !isLocalMessage(comment),
  },
  {
    id: 'delete',
    label: 'Удалить',
    destructive: true,
    // Своё неотправленное убирается только у себя, отправленное — для всех.
    isVisible: ({ isOwn }) => isOwn,
  },
];

export function visibleCommentActions(context: CommentActionContext): CommentAction[] {
  return COMMENT_ACTIONS.filter((action) => action.isVisible(context));
}
