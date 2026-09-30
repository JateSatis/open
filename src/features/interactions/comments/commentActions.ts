// Что можно сделать с комментарием по долгому нажатию. Видимость пункта —
// вежливость интерфейса: права всегда проверяет база.

import type { ContextMenuAction } from '@/features/chats/MessageContextMenu';
import { hasCopyableText, isEditable, isLocalMessage } from '@/features/chats/messageActions';
import type { CommentItem } from '@/features/interactions/comments/commentItem';

export type CommentActionId = 'retry' | 'copy' | 'edit' | 'delete';

export type CommentActionContext = {
  comment: CommentItem;
  isOwn: boolean;
  /** Сообщение, к которому комментарий, живо: у удалённого новых версий не принимают. */
  targetLive: boolean;
};

type CommentAction = ContextMenuAction<CommentActionId> & {
  isVisible: (context: CommentActionContext) => boolean;
};

/** Пункты в том порядке, в котором их видит человек. Реакций на комментарии пока нет. */
export const COMMENT_ACTIONS: readonly CommentAction[] = [
  {
    id: 'retry',
    label: 'Повторить',
    isVisible: ({ comment }) => comment.status === 'failed',
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
