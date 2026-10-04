import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';

import { confirm } from '@/components/ConfirmDialog';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { CommentActionId } from '@/features/interactions/comments/commentActions';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import type { CommentsState } from '@/features/interactions/comments/useComments';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

type Options = {
  thread: Pick<CommentsState, 'retry' | 'discard' | 'remove'>;
  /** «Изменить»: поле панели переходит в правку этого комментария. */
  edit: (comment: CommentItem) => void;
  /** «Ответить»: комментарий встаёт плашкой над полем. */
  reply: (comment: CommentItem) => void;
  /** «Выбрать»: выбор с этим комментарием уже отмеченным. */
  select: (comment: CommentItem) => void;
  /** «Переслать»: дальше — выбор чата. */
  forward: (comment: CommentItem) => void;
};

/** Что делает каждый пункт меню комментария. */
export function useCommentActionHandlers({ thread, edit, reply, select, forward }: Options) {
  const { retry, discard, remove } = thread;

  return useCallback(
    (id: CommentActionId, comment: CommentItem) => {
      switch (id) {
        case 'retry':
          if (comment.localId) retry(comment.localId);
          return;
        case 'reply':
          reply(comment);
          return;
        case 'select':
          select(comment);
          return;
        case 'forward':
          forward(comment);
          return;
        case 'copy':
          void Clipboard.setStringAsync(comment.text ?? '').then(() => showNotice('Скопировано'));
          return;
        case 'edit':
          edit(comment);
          return;
        case 'delete':
          if (isLocalMessage(comment)) {
            // Неотправленного на сервере нет — спрашивать «исчезнет у всех» не о чем.
            if (comment.localId) discard(comment.localId);
            return;
          }

          void confirm({
            title: 'Удалить комментарий?',
            message: 'Он исчезнет у всех.',
            confirmLabel: 'Удалить',
            cancelLabel: 'Отмена',
            destructive: true,
          }).then((confirmed) => {
            if (!confirmed) return;

            remove(comment).catch((cause: unknown) =>
              showNotice(
                isNetworkError(cause)
                  ? 'Не удалось удалить комментарий: нет связи'
                  : 'Не удалось удалить комментарий',
                'error',
              ),
            );
          });
          return;
      }
    },
    [discard, edit, forward, remove, reply, retry, select],
  );
}
