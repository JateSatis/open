import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import type { CommentRow } from './rows';
import type { usePanelComments } from './usePanelComments';
import type { PanelSheet } from './usePanelSheet';

import type { CommentPop, CommentTarget } from '@/api/comments';
import type { ForwardedComment } from '@/api/chats';
import { startForwardPick } from '@/features/chats/composerDraftStore';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import { canReactTo } from '@/features/chats/messageActions';
import type { AnchorRect, MenuAnchor } from '@/features/chats/MessageContextMenu';
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
  commentThreadOf,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import { loadedComments } from '@/features/interactions/comments/commentsCache';
import {
  getOpenCommentThread,
  setOpenCommentThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { useCommentActionHandlers } from '@/features/interactions/comments/useCommentActionHandlers';
import { useCommentReplySelection } from '@/features/interactions/comments/useCommentReplySelection';
import { menuReactionSet } from '@/features/interactions/reactionState';

import type { LocalMedia } from '@/features/media';
import { focusWithKeyboard } from '@/lib/windowFocus';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Options = {
  target: CommentsPanelTarget;
  /** Чат экрана под панелью: под выбором чата лежит он, а не чат сообщения. */
  hostChatId?: string;
  live: Extract<CommentTarget, { state: 'live' }> | null;
  data: ReturnType<typeof usePanelComments>;
  currentUserId: string | null;
  /** Открытое окно треда — id корня. */
  openCommentThread: string | null;
  inputRef: RefObject<TextInput | null>;
  listRef: RefObject<FlashListRef<CommentRow> | null>;
  commentThreadListRef: RefObject<FlashListRef<CommentRow> | null>;
  sheet: PanelSheet;
  /** Видимая часть списка комментариев в окне — по ней обрезается копия облачка под меню. */
  measureViewport: () => Promise<AnchorRect | null>;
};

/** Пересланный комментарий до ответа сервера — как его нарисует чат. */
function forwardedOf(
  comment: CommentItem,
  live: Options['live'],
  pop: CommentPop | null,
  chat: { id: string; name: string } | null,
  amMember: boolean,
): ForwardedComment {
  return {
    id: comment.id,
    subject: { type: pop ? 'pop' : 'message', id: comment.targetId },
    chatId: comment.chatId,
    commentThreadRootId: comment.commentThreadRootId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorAvatarUrl,
    kind: comment.kind === 'media' || comment.kind === 'voice' ? comment.kind : 'text',
    text: comment.text,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    attachments: comment.attachments,
    reactions: comment.reactions,
    fragmentId: comment.fragmentId ?? null,
    fragmentQuote: comment.fragmentQuote ?? null,
    target: live
      ? {
          id: live.message.id,
          seq: live.message.seq,
          authorId: live.message.authorId,
          authorName: live.authorName,
          preview: previewOf(live.message as ChatMessage),
        }
      : null,
    pop: pop
      ? { id: pop.id, channelId: pop.channelId, posterUrl: pop.posterUrl, caption: pop.caption }
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
  openCommentThread,
  inputRef,
  listRef,
  commentThreadListRef,
  sheet,
  measureViewport,
}: Options) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { subject } = target;
  const targetId = subject.id;
  const { comments, rows, commentThreadRows, amMember, pop } = data;
  // У попа — чат постов его канала.
  const chatId = live?.message.chatId ?? data.pop?.postsChatId ?? target.chatId ?? '';
  const { chat } = useChat(chatId);
  const draft = useComposerDraft(commentThreadKey(targetId));
  const menu = useMessageMenu<CommentItem>(measureViewport);
  const { close } = sheet;
  // Выбор — среди комментариев того окна, что на экране.
  const visible = useMemo(
    () => commentsOf(openCommentThread ? commentThreadRows : rows),
    [openCommentThread, rows, commentThreadRows],
  );

  const { saveEdit: saveCommentEdit } = comments;
  // Правка — общая с сообщениями: поле знает только `ChatMessage`, а здесь им
  // всегда оказывается комментарий.
  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => saveCommentEdit(original as CommentItem, result),
    [saveCommentEdit],
  );
  const edit = useMessageEdit({
    chatId: commentThreadKey(targetId),
    draft,
    composerRef: inputRef,
    saveEdit,
    ownWindow: true,
  });

  const forward = useCallback(
    (picked: CommentItem[]) => {
      const sendable = picked.filter((comment) => !comment.deleted);

      if (sendable.length === 0) return;

      // У попа подпись «Комментарий из …» — имя канала.
      const name = pop ? pop.channelTitle : chat ? chatTitle(chat, currentUserId) : 'Чат';

      startForwardPick({
        comments: sendable.map((comment) =>
          forwardedOf(comment, live, pop, chatId ? { id: chatId, name } : null, amMember),
        ),
      });
      // Окно панели — поверх экранов: выбор чата открывается за ним.
      close();
      router.push({
        pathname: '/chats/forward',
        params: hostChatId ? { from: hostChatId } : {},
      });
    },
    [amMember, chat, chatId, close, currentUserId, hostChatId, live, pop, router],
  );

  /**
   * Ответ на верхнеуровневый в основном списке — это ответ в его тред:
   * открывается окно треда, поле в фокусе, цитаты нет — в треде любое
   * сообщение и так ответ.
   */
  const replyInCommentThread = useCallback(
    (picked: CommentItem[]) => {
      const [only, ...rest] = picked;

      if (getOpenCommentThread() || !only || rest.length > 0 || only.commentThreadRootId) return false;

      setOpenCommentThread(only.id);
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
    commentsState: comments,
    onForward: forward,
    replyElsewhere: replyInCommentThread,
  });

  const replyTo = useCallback((comment: CommentItem) => startReply([comment]), [startReply]);
  const selectOne = useCallback((comment: CommentItem) => selection.start(comment.id), [selection]);
  const toggleSelected = useCallback(
    (comment: CommentItem) => selection.toggle(comment.id),
    [selection],
  );
  const forwardOne = useCallback((comment: CommentItem) => forward([comment]), [forward]);

  const runAction = useCommentActionHandlers({
    commentsState: comments,
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

  const enteredCommentThread = useRef(openCommentThread);

  useEffect(() => {
    if (enteredCommentThread.current === openCommentThread) return;

    enteredCommentThread.current = openCommentThread;
    resetRef.current();
  }, [openCommentThread]);

  // Шит закрылся — цитата ответа не переживает его: черновик сообщения
  // остаётся, а следующее открытие начнётся с основного списка, где эта
  // цитата незаметно увела бы комментарий в тред.
  useEffect(() => () => resetQuoteRef.current(), []);

  const openCommentThreadOf = useCallback((rootId: string) => setOpenCommentThread(rootId), []);
  const exitCommentThread = useCallback(() => setOpenCommentThread(null), []);

  /** Тред ответа с цитатами, отправленного не из окна треда: тред первой цитаты. */
  const commentThreadOfQuotes = useCallback(
    (quotes: LiveQuote[]): string | null => {
      const [first] = quotes;

      if (!first) return null;

      const quoted = loadedComments(queryClient, targetId).get(first.messageId);

      return quoted ? commentThreadOf(quoted) : first.messageId;
    },
    [targetId, queryClient],
  );

  /**
   * После отправки: ответ — в конце окна треда, туда и листаем; свой
   * верхнеуровневый — наверху основного списка.
   */
  const afterSend = useCallback(
    (commentThreadRootId: string | null) => {
      // После того как строка встала в список: он держит видимые строки на
      // месте, и новая наверху ушла бы под шапку шита.
      void (async () => {
        await nextFrame();
        await nextFrame();

        if (commentThreadRootId) commentThreadListRef.current?.scrollToEnd({ animated: true });
        else listRef.current?.scrollToOffset({ offset: 0, animated: true });
      })();
    },
    [listRef, commentThreadListRef],
  );

  const { mode } = draft;
  const replies = useMemo(() => (mode?.type === 'reply' ? mode.quotes : []), [mode]);
  const { send, sendVoice: sendCommentVoice } = comments;

  // Написанное в окне треда — ответ в этот тред, с цитатой или без.
  const commentThreadRootId = openCommentThread ?? commentThreadOfQuotes(replies);

  const submit = useCallback(() => {
    send(draft.text, draft.media(), replies, commentThreadRootId);
    draft.clear();
    afterSend(commentThreadRootId);
  }, [afterSend, draft, replies, send, commentThreadRootId]);

  const sendVoice = useCallback(
    (voice: LocalMedia) => {
      sendCommentVoice(voice, replies, commentThreadRootId);
      if (replies.length > 0) draft.setMode(null);
      afterSend(commentThreadRootId);
    },
    [afterSend, draft, replies, sendCommentVoice, commentThreadRootId],
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

    if (getOpenCommentThread()) {
      setOpenCommentThread(null);
      return true;
    }

    return false;
  }, [edit, selection]);

  const closed = data.about?.state === 'deleted' || data.about?.state === 'missing';
  // Закреп — автору контента. Здесь только показ пункта: право решает база.
  const canPin = pop
    ? amMember
    : Boolean(
        live &&
          currentUserId &&
          (chat?.kind === 'channel'
            ? chat.participants.some((person) => person.id === currentUserId)
            : live.message.authorId === currentUserId),
      );
  const menuComment = menu.target?.item ?? null;
  const menuActions = menuComment
    ? visibleCommentActions({
        comment: menuComment,
        isOwn: menuComment.authorId === currentUserId,
        targetLive: !closed,
        canPin,
        isPinned: menuComment.id === comments.pinnedId,
      })
    : [];
  const { react } = comments;
  // Реакция из меню — на комментарий, каким он стал к моменту тапа.
  const menuReactions =
    menuComment && canReactTo(menuComment)
      ? {
          // У комментария один общий ряд: полон — только уже стоящие.
          ...menuReactionSet(menuComment.reactions, 'comment'),
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
    (comment: CommentItem, anchor: MenuAnchor) => menu.open(comment, anchor),
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
    openCommentThread: openCommentThreadOf,
    exitCommentThread,
    submit,
    sendVoice,
    back,
    openMenu,
    closeMenu: menu.close,
    menuAnchor: menu.target?.anchor ?? null,
    menuViewport: menu.target?.viewport ?? null,
    menuComment,
    menuActions,
    menuReactions,
    runMenuAction,
    extraData,
  };
}

export type PanelActions = ReturnType<typeof usePanelActions>;
