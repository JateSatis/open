import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import { confirm } from '@/components/ConfirmDialog';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import type { MessageListRow } from '@/features/chats/islands/rows';
import {
  SELECTION_ACTIONS,
  type SelectionActionContext,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import { DELETED_ACCOUNT, quoteOf } from '@/features/chats/messageQuote';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageSelection } from '@/features/chats/useMessageSelection';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import type { CommentsState } from '@/features/interactions/comments/useComments';
import { showNotice } from '@/features/notifications/alertsStore';
import { focusWithKeyboard } from '@/lib/windowFocus';

/** Кнопки панели выбора у комментариев — без пересылки: её у комментариев нет. */
export const COMMENT_SELECTION_ACTIONS = SELECTION_ACTIONS.filter(
  (action) => action.id !== 'forward',
);

type Options = {
  comments: CommentItem[];
  currentUserId: string | null;
  draft: ComposerDraft;
  inputRef: RefObject<TextInput | null>;
  thread: Pick<CommentsState, 'remove'>;
  /** Поле в фокусе — шит разворачивается. */
  onFieldActivate: () => void;
};

const nameOf = (comment: CommentItem) => comment.authorName ?? DELETED_ACCOUNT;

/**
 * Ответ и выбор в ветке комментариев — как в переписке: ответ встаёт
 * плашкой над полем со всеми цитатами по порядку, выбор отмечает комментарии
 * и даёт ответить, скопировать или удалить свои разом.
 */
export function useCommentReplySelection({
  comments,
  currentUserId,
  draft,
  inputRef,
  thread,
  onFieldActivate,
}: Options) {
  // Выбор переписки работает со строками — комментарий и есть строка-сообщение.
  const rows = useMemo<MessageListRow[]>(
    () => comments.map((comment) => ({ type: 'message', key: comment.id, message: comment })),
    [comments],
  );
  const selection = useMessageSelection(rows, currentUserId);
  const { setMode } = draft;

  const startReply = useCallback(
    (picked: CommentItem[]) => {
      if (picked.length === 0) return;

      setMode({ type: 'reply', quotes: picked.map((comment) => quoteOf(comment, nameOf(comment))) });
      claimKeyboardForComments();
      onFieldActivate();
      focusWithKeyboard(inputRef, undefined, true);
    },
    [inputRef, onFieldActivate, setMode],
  );

  const selected = useMemo(
    () => selection.selected.map((row) => (row as MessageListRow).message as CommentItem),
    [selection.selected],
  );

  const context = useMemo<SelectionActionContext>(
    // Ответить на комментарий может любой — участие в чате тут не нужно.
    () => ({ selected: selection.selected, currentUserId, isMember: true }),
    [currentUserId, selection.selected],
  );

  const { clear } = selection;
  const { remove } = thread;

  const runSelectionAction = useCallback(
    (id: SelectionActionId) => {
      switch (id) {
        case 'reply':
          startReply(selected);
          clear();
          return;
        case 'copy': {
          const names = new Map(selected.map((comment) => [comment.authorId, nameOf(comment)]));

          void Clipboard.setStringAsync(
            formatMessagesForCopy(selected, (authorId) => names.get(authorId) ?? DELETED_ACCOUNT),
          ).then(() => showNotice('Скопировано'));
          clear();
          return;
        }
        case 'delete':
          void confirm({
            title: selected.length === 1 ? 'Удалить комментарий?' : 'Удалить комментарии?',
            message: 'Они исчезнут у всех.',
            confirmLabel: 'Удалить',
            cancelLabel: 'Отмена',
            destructive: true,
          }).then(async (confirmed) => {
            if (!confirmed) return;

            clear();

            for (const comment of selected) {
              await remove(comment).catch(() =>
                showNotice('Не удалось удалить комментарий', 'error'),
              );
            }
          });
          return;
        case 'forward':
          return;
      }
    },
    [clear, remove, selected, startReply],
  );

  return { selection, selectionContext: context, runSelectionAction, startReply };
}
