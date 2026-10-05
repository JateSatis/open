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
import { canReactTo } from '@/features/chats/messageActions';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { DELETED_ACCOUNT, previewOf, quoteOf } from '@/features/chats/messageQuote';
import type { ChatMessage, EditResult, LiveQuote } from '@/features/chats/messages/types';
import { useChat } from '@/features/chats/useChat';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { chatTitle } from '@/features/chats/chatDisplay';
import { visibleCommentActions } from '@/features/interactions/comments/commentActions';
import type { CommentThreadTarget } from '@/features/interactions/comments/commentDelivery';
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

const commentKey = (comment: CommentItem) => comment.id;
const nameOf = (comment: CommentItem) => comment.authorName ?? DELETED_ACCOUNT;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Options = {
  target: CommentsPanelTarget;
  /** Чат экрана под панелью: под выбором чата лежит он, а не чат сообщения. */
  hostChatId?: string;
  live: Extract<CommentTarget, { state: 'live' }> | null;
  data: ReturnType<typeof usePanelComments>;
  currentUserId: string | null;
  inputRef: RefObject<TextInput | null>;
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  sheet: PanelSheet;
  /** Тред скрывается: с липкого корня — со сдвигом скролла (`useStickyThread`). */
  stickyCollapse: () => void;
  /** Раскрывается другой тред: закрываемый выше не сдвигает экран (`useStickyThread`). */
  stickySwitch: (nextRootId: string) => void;
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

/**
 * Что панель делает по касаниям: меню и выбор, ответ в тред, правка,
 * отправка, пересылка, раскрытие тредов, «назад».
 */
export function usePanelActions({
  target,
  hostChatId,
  live,
  data,
  currentUserId,
  inputRef,
  listRef,
  sheet,
  stickyCollapse,
  stickySwitch,
  jump,
}: Options) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { messageId } = target;
  const { comments, visible, rows, amMember } = data;
  const chatId = live?.message.chatId ?? target.chatId ?? '';
  const { chat } = useChat(chatId);
  const draft = useComposerDraft(commentThreadKey(messageId));
  const menu = useMessageMenu<CommentItem>(commentKey);
  const latestRows = useRef(rows);
  const { close } = sheet;

  useEffect(() => {
    latestRows.current = rows;
  }, [rows]);

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

  const { selection, selectionContext, runSelectionAction, startReply } = useCommentReplySelection({
    comments: visible,
    currentUserId,
    draft,
    inputRef,
    thread: comments,
    onForward: forward,
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

  /** Второй тред раскрывается, первый закрывается; свой — скрывается. */
  const toggleThread = useCallback(
    (rootId: string) => {
      if (getOpenThread() === rootId) {
        stickyCollapse();
        setOpenThread(null);
        return;
      }

      if (getOpenThread()) stickySwitch(rootId);

      setOpenThread(rootId);
    },
    [stickyCollapse, stickySwitch],
  );

  /** Куда ляжет ответ с этими цитатами: тред их корня. */
  const threadTargetOf = useCallback(
    (quotes: LiveQuote[]): CommentThreadTarget | null => {
      const [first] = quotes;

      if (!first) return null;

      const loaded = loadedComments(queryClient, messageId);
      const quoted = loaded.get(first.messageId);
      const rootId = quoted ? threadOf(quoted) : first.messageId;
      const root = loaded.get(rootId);

      return { rootId, rootQuote: root && !root.deleted ? quoteOf(root, nameOf(root)) : null };
    },
    [messageId, queryClient],
  );

  /**
   * После отправки: ответ — тред раскрыт, его конец на виду; свой
   * верхнеуровневый — наверху списка, туда и листаем, если ушли вниз.
   */
  const afterSend = useCallback(
    (thread: CommentThreadTarget | null) => {
      if (!thread) {
        // После того как строка встала в список: он держит видимые строки на
        // месте, и новая наверху ушла бы под шапку шита.
        void (async () => {
          await nextFrame();
          await nextFrame();

          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        })();
        return;
      }

      setOpenThread(thread.rootId);

      void (async () => {
        await nextFrame();
        await nextFrame();

        const current = latestRows.current;
        let last = -1;

        current.forEach((row, index) => {
          if (row.thread?.rootId === thread.rootId) last = index;
        });

        if (last !== -1) listRef.current?.scrollToIndex({ index: last, viewPosition: 0.6, animated: true });
      })();
    },
    [listRef],
  );

  const { mode } = draft;
  const replies = useMemo(() => (mode?.type === 'reply' ? mode.quotes : []), [mode]);
  const { send, sendVoice: sendCommentVoice } = comments;

  const submit = useCallback(() => {
    const thread = threadTargetOf(replies);

    send(draft.text, draft.media(), replies, thread);
    draft.clear();
    afterSend(thread);
  }, [afterSend, draft, replies, send, threadTargetOf]);

  const sendVoice = useCallback(
    (voice: LocalMedia) => {
      const thread = threadTargetOf(replies);

      sendCommentVoice(voice, replies, thread);
      if (replies.length > 0) draft.setMode(null);
      afterSend(thread);
    },
    [afterSend, draft, replies, sendCommentVoice, threadTargetOf],
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

    if (!edit.mode) return false;

    void edit.leave();
    return true;
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
    toggleThread,
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
