import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import { confirm } from '@/components/ConfirmDialog';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import type { BubbleRow, MessageListRow } from '@/features/chats/islands/rows';
import {
  SELECTION_ACTIONS,
  type SelectionAction,
  type SelectionActionContext,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import { DELETED_ACCOUNT, quoteOf } from '@/features/chats/messageQuote';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageSelection } from '@/features/chats/useMessageSelection';
import { threadOf, type CommentItem } from '@/features/interactions/comments/commentItem';
import type { CommentsState } from '@/features/interactions/comments/useComments';
import { showNotice } from '@/features/notifications/alertsStore';
import { focusWithKeyboard } from '@/lib/windowFocus';

const commentOf = (row: BubbleRow) => (row as MessageListRow).message as CommentItem;

/** Все — из одного треда: ответ ложится только в один тред. */
export function inOneThread(comments: Pick<CommentItem, 'id' | 'threadRootId'>[]): boolean {
  return new Set(comments.map(threadOf)).size <= 1;
}

/**
 * Кнопки панели выбора у комментариев — те же, что в переписке. «Ответить» —
 * только на комментарии одного треда: процитировать два треда одним ответом
 * нельзя (это проверяет и база).
 */
export const COMMENT_SELECTION_ACTIONS: readonly SelectionAction[] = SELECTION_ACTIONS.map(
  (action) =>
    action.id === 'reply'
      ? {
          ...action,
          isEnabled: (context: SelectionActionContext) =>
            action.isEnabled(context) && inOneThread(context.selected.map(commentOf)),
        }
      : action,
);

type Options = {
  /** Комментарии на экране — в порядке строк сверху вниз. */
  comments: CommentItem[];
  currentUserId: string | null;
  draft: ComposerDraft;
  inputRef: RefObject<TextInput | null>;
  thread: Pick<CommentsState, 'remove'>;
  /** «Переслать»: комментарии в порядке экрана — дальше выбор чата. */
  onForward: (comments: CommentItem[]) => void;
  /**
   * «Ответить» решается снаружи — например, открывается окно треда вместо
   * цитаты. `true` — ответ взят, цитата в поле не встаёт.
   */
  replyElsewhere?: (comments: CommentItem[]) => boolean;
};

const nameOf = (comment: CommentItem) => comment.authorName ?? DELETED_ACCOUNT;

/**
 * Ответ и выбор в комментариях — как в переписке: ответ встаёт плашкой над
 * полем со всеми цитатами по порядку, выбор отмечает комментарии и даёт
 * ответить, переслать, скопировать или удалить свои разом.
 */
export function useCommentReplySelection({
  comments,
  currentUserId,
  draft,
  inputRef,
  thread,
  onForward,
  replyElsewhere,
}: Options) {
  // Выбор переписки работает со строками перевёрнутого списка и отдаёт их
  // в обратном порядке — даём ему строки снизу вверх, получаем порядок экрана.
  const rows = useMemo<MessageListRow[]>(
    () =>
      comments
        .map((comment): MessageListRow => ({ type: 'message', key: comment.id, message: comment }))
        .reverse(),
    [comments],
  );
  const selection = useMessageSelection(rows, currentUserId);
  const { setMode } = draft;

  const startReply = useCallback(
    (picked: CommentItem[]) => {
      if (picked.length === 0) return;
      if (replyElsewhere?.(picked)) return;

      if (!inOneThread(picked)) {
        showNotice('Ответить можно только в один тред', 'error');
        return;
      }

      setMode({ type: 'reply', quotes: picked.map((comment) => quoteOf(comment, nameOf(comment))) });
      claimKeyboardForComments();
      focusWithKeyboard(inputRef, undefined, true);
    },
    [inputRef, replyElsewhere, setMode],
  );

  const selected = useMemo(() => selection.selected.map(commentOf), [selection.selected]);

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
        case 'forward':
          onForward(selected);
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
      }
    },
    [clear, onForward, remove, selected, startReply],
  );

  return { selection, selectionContext: context, runSelectionAction, startReply };
}
