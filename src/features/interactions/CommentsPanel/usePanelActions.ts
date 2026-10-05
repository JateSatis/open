import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import type { CommentRow } from './rows';
import type { usePanelComments } from './usePanelComments';
import type { PanelSheet } from './usePanelSheet';

import type { CommentTarget } from '@/api/comments';
import type { ForwardedComment } from '@/api/chats';
import { startForwardPick } from '@/features/chats/composerDraftStore';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import { canReactTo } from '@/features/chats/messageActions';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { previewOf } from '@/features/chats/messageQuote';
import type { ChatMessage, EditResult, LiveQuote } from '@/features/chats/messages/types';
import { useChat } from '@/features/chats/useChat';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { chatTitle } from '@/features/chats/chatDisplay';
import { visibleCommentActions } from '@/features/interactions/comments/commentActions';
import {
  commentThreadKey,
  threadOf,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import { loadedComments } from '@/features/interactions/comments/commentsCache';
import {
  getOpenThread,
  setOpenThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { useCommentActionHandlers } from '@/features/interactions/comments/useCommentActionHandlers';
import { useCommentReplySelection } from '@/features/interactions/comments/useCommentReplySelection';
import { showNotice } from '@/features/notifications/alertsStore';
import type { LocalMedia } from '@/features/media';
import { focusWithKeyboard } from '@/lib/windowFocus';

const commentKey = (comment: CommentItem) => comment.id;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Options = {
  target: CommentsPanelTarget;
  /** Чат экрана под панелью: под выбором чата лежит он, а не чат сообщения. */
  hostChatId?: string;
  live: Extract<CommentTarget, { state: 'live' }> | null;
  data: ReturnType<typeof usePanelComments>;
  currentUserId: string | null;
  /** Открытое окно треда — id корня. */
  openThread: string | null;
  inputRef: RefObject<TextInput | null>;
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  threadListRef: RefObject<FlashListRef<CommentRow> | null>;
  sheet: PanelSheet;
  /** Прыжок к комментарию в окне треда — по тапу на цитату. */
  jump: (commentId: string, options?: { flash?: boolean }) => Promise<boolean>;
};

/** Пересланный комментарий до ответа сервера — как его нарисует чат. */
function forwardedOf(
  comment: CommentItem,
  live: Options['live'],
  chat: { id: string; name: string } | null,
  amMember: boolean,
): ForwardedComment {
  return {
    id: comment.id,
    messageId: comment.messageId,
    chatId: comment.chatId,
    threadRootId: comment.threadRootId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorAvatarUrl,
    kind: comment.kind === 'media' || comment.kind === 'voice' ? comment.kind : 'text',
    text: comment.text,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    attachments: comment.attachments,
    reactions: comment.reactions,
    target: live
      ? {
          id: live.message.id,
          createdAt: live.message.createdAt,
          authorId: live.message.authorId,
          authorName: live.authorName,
          preview: previewOf(live.message as ChatMessage),
        }
      : null,
    chat: chat ? { ...chat, amMember } : null,
  };
}

/** Комментарии на экране — по порядку строк. */
function commentsOf(rows: CommentRow[]): CommentItem[] {
  return rows.flatMap((row) => (row.type === 'comment' && !row.comment.deleted ? [row.comment] : []));
}

/**
 * Что панель делает по касаниям: меню и выбор, ответ в тред, правка,
 * отправка, пересылка, окно треда, «назад».
 */
export function usePanelActions({
  target,
  hostChatId,
  live,
  data,
  currentUserId,
  openThread,
  inputRef,
  listRef,
  threadListRef,
  sheet,
  jump,
}: Options) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { messageId } = target;
  const { comments, rows, threadRows, amMember } = data;
  const chatId = live?.message.chatId ?? target.chatId ?? '';
  const { chat } = useChat(chatId);
  const draft = useComposerDraft(commentThreadKey(messageId));
  const menu = useMessageMenu<CommentItem>(commentKey);
  const { close } = sheet;
  // Выбор — среди комментариев того окна, что на экране.
  const visible = useMemo(
    () => commentsOf(openThread ? threadRows : rows),
    [openThread, rows, threadRows],
  );

  const { saveEdit: saveCommentEdit } = comments;
  // Правка — общая с сообщениями: поле знает только `ChatMessage`, а здесь им
  // всегда оказывается комментарий.
  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => saveCommentEdit(original as CommentItem, result),
    [saveCommentEdit],
  );
  const edit = useMessageEdit({
    chatId: commentThreadKey(messageId),
    draft,
    composerRef: inputRef,
    saveEdit,
    ownWindow: true,
  });

  const forward = useCallback(
    (picked: CommentItem[]) => {
      const sendable = picked.filter((comment) => !comment.deleted);

      if (sendable.length === 0) return;

      const name = chat ? chatTitle(chat, currentUserId) : 'Чат';

      startForwardPick({
        comments: sendable.map((comment) =>
          forwardedOf(comment, live, chatId ? { id: chatId, name } : null, amMember),
        ),
      });
      // Окно панели — поверх экранов: выбор чата открывается за ним.
      close();
      router.push({
        pathname: '/chats/forward',
        params: hostChatId ? { from: hostChatId } : {},
      });
    },
    [amMember, chat, chatId, close, currentUserId, hostChatId, live, router],
  );

  /**
   * Ответ на верхнеуровневый в основном списке — это ответ в его тред:
   * открывается окно треда, поле в фокусе, цитаты нет — в треде любое
   * сообщение и так ответ.
   */
  const replyInThread = useCallback(
    (picked: CommentItem[]) => {
      const [only, ...rest] = picked;

      if (getOpenThread() || !only || rest.length > 0 || only.threadRootId) return false;

      setOpenThread(only.id);
      claimKeyboardForComments();
      focusWithKeyboard(inputRef, undefined, true);
      return true;
    },
    [inputRef],
  );

  const { selection, selectionContext, runSelectionAction, startReply } = useCommentReplySelection({
    comments: visible,
    currentUserId,
    draft,
    inputRef,
    thread: comments,
    onForward: forward,
    replyElsewhere: replyInThread,
  });

  const replyTo = useCallback((comment: CommentItem) => startReply([comment]), [startReply]);
  const selectOne = useCallback((comment: CommentItem) => selection.start(comment.id), [selection]);
  const toggleSelected = useCallback(
    (comment: CommentItem) => selection.toggle(comment.id),
    [selection],
  );
  const forwardOne = useCallback((comment: CommentItem) => forward([comment]), [forward]);

  const runAction = useCommentActionHandlers({
    thread: comments,
    edit: edit.start,
    reply: replyTo,
    select: selectOne,
    forward: forwardOne,
  });

  /**
   * Смена окна — вход в тред и выход — снимает выбор и правку: они про
   * строки того окна. Текст поля остаётся, а цитата снимается: иначе ответ
   * с цитатой из основного списка незаметно ушёл бы в тред.
   */
  const resetRef = useRef(() => {});
  const resetQuoteRef = useRef(() => {});

  useEffect(() => {
    resetQuoteRef.current = () => {
      if (draft.mode?.type === 'reply') draft.setMode(null);
    };
    resetRef.current = () => {
      selection.clear();
      if (edit.mode) void edit.leave();
      else if (draft.mode?.type === 'reply') draft.setMode(null);
    };
  });

  const enteredThread = useRef(openThread);

  useEffect(() => {
    if (enteredThread.current === openThread) return;

    enteredThread.current = openThread;
    resetRef.current();
  }, [openThread]);

  // Шит закрылся — цитата ответа не переживает его: черновик сообщения
  // остаётся, а следующее открытие начнётся с основного списка, где эта
  // цитата незаметно увела бы комментарий в тред.
  useEffect(() => () => resetQuoteRef.current(), []);

  const openThreadOf = useCallback((rootId: string) => setOpenThread(rootId), []);
  const exitThread = useCallback(() => setOpenThread(null), []);

  /** Тред ответа с цитатами, отправленного не из окна треда: тред первой цитаты. */
  const threadOfQuotes = useCallback(
    (quotes: LiveQuote[]): string | null => {
      const [first] = quotes;

      if (!first) return null;

      const quoted = loadedComments(queryClient, messageId).get(first.messageId);

      return quoted ? threadOf(quoted) : first.messageId;
    },
    [messageId, queryClient],
  );

  /**
   * После отправки: ответ — в конце окна треда, туда и листаем; свой
   * верхнеуровневый — наверху основного списка.
   */
  const afterSend = useCallback(
    (threadRootId: string | null) => {
      // После того как строка встала в список: он держит видимые строки на
      // месте, и новая наверху ушла бы под шапку шита.
      void (async () => {
        await nextFrame();
        await nextFrame();

        if (threadRootId) threadListRef.current?.scrollToEnd({ animated: true });
        else listRef.current?.scrollToOffset({ offset: 0, animated: true });
      })();
    },
    [listRef, threadListRef],
  );

  const { mode } = draft;
  const replies = useMemo(() => (mode?.type === 'reply' ? mode.quotes : []), [mode]);
  const { send, sendVoice: sendCommentVoice } = comments;

  // Написанное в окне треда — ответ в этот тред, с цитатой или без.
  const threadRootId = openThread ?? threadOfQuotes(replies);

  const submit = useCallback(() => {
    send(draft.text, draft.media(), replies, threadRootId);
    draft.clear();
    afterSend(threadRootId);
  }, [afterSend, draft, replies, send, threadRootId]);

  const sendVoice = useCallback(
    (voice: LocalMedia) => {
      sendCommentVoice(voice, replies, threadRootId);
      if (replies.length > 0) draft.setMode(null);
      afterSend(threadRootId);
    },
    [afterSend, draft, replies, sendCommentVoice, threadRootId],
  );

  const jumpToQuote = useCallback(
    async (commentId: string) => {
      if (!(await jump(commentId))) showNotice('Не удалось найти комментарий', 'error');
    },
    [jump],
  );

  const back = useCallback(() => {
    if (selection.isActive) {
      selection.clear();
      return true;
    }

    if (edit.mode) {
      void edit.leave();
      return true;
    }

    if (getOpenThread()) {
      setOpenThread(null);
      return true;
    }

    return false;
  }, [edit, selection]);

  const closed = data.about?.state === 'deleted' || data.about?.state === 'missing';
  const menuComment = menu.target?.item ?? null;
  const menuActions = menuComment
    ? visibleCommentActions({
        comment: menuComment,
        isOwn: menuComment.authorId === currentUserId,
        targetLive: !closed,
      })
    : [];
  const { react } = comments;
  // Реакция из меню — на комментарий, каким он стал к моменту тапа.
  const menuReactions =
    menuComment && canReactTo(menuComment)
      ? {
          selected: menuComment.reactions.mine?.emoji ?? null,
          onSelect: (emoji: string) =>
            react(visible.find((item) => item.id === menuComment.id) ?? menuComment, emoji),
        }
      : null;

  const runMenuAction = useCallback(
    (id: string) => {
      if (menuComment) runAction(id as Parameters<typeof runAction>[0], menuComment);
    },
    [menuComment, runAction],
  );

  const openMenu = useCallback(
    (comment: CommentItem, anchor: AnchorRect) => menu.open(comment, anchor),
    [menu],
  );

  const extraData = useMemo(() => ({ selection }), [selection]);

  return {
    draft,
    inputRef,
    edit,
    selection,
    selectionContext,
    runSelectionAction,
    replyTo,
    selectOne,
    toggleSelected,
    openThread: openThreadOf,
    exitThread,
    submit,
    sendVoice,
    jumpToQuote,
    back,
    openMenu,
    closeMenu: menu.close,
    menuAnchor: menu.target?.anchor ?? null,
    menuComment,
    menuActions,
    menuReactions,
    runMenuAction,
    extraData,
  };
}

export type PanelActions = ReturnType<typeof usePanelActions>;
