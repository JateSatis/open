import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deleteComment, listComments, subscribeToComments } from '@/api/comments';
import { usePendingEditsOf } from '@/features/chats/messages/pendingEdits';
import type { EditResult, LiveQuote } from '@/features/chats/messages/types';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import {
  deliverComment,
  discardComment,
  retryComment,
  sendCommentPost,
  sendCommentVoice,
  type CommentSendContext,
} from '@/features/interactions/comments/commentDelivery';
import { saveCommentEdit } from '@/features/interactions/comments/commentEditing';
import { commentThreadKey, type CommentItem } from '@/features/interactions/comments/commentItem';
import { outboxComments, useOutboxComments } from '@/features/interactions/comments/commentOutbox';
import {
  commentsQueryKey,
  mergeComments,
  readComments,
  removeComments,
  updateComments,
} from '@/features/interactions/comments/commentsCache';
import {
  loadComments,
  syncCommentReactions,
  syncComments,
} from '@/features/interactions/comments/commentSync';
import { commentTargetQueryKey } from '@/features/interactions/comments/useCommentTarget';
import { outgoingOf } from '@/features/chats/messages/delivery';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';
import { usePendingReactionMap } from '@/features/interactions/pendingReactions';
import { sendReaction } from '@/features/interactions/reactionSender';
import {
  audienceOf,
  nextReaction,
  withMyReaction,
} from '@/features/interactions/reactionState';
import { useMyProfile } from '@/features/profile/queries';
import { describeLoadError } from '@/lib/network';

/**
 * Столько копить события, прежде чем перечитать: под горячим сообщением
 * комментарии сыплются пачками, и база получает запрос на пачку, а не на
 * каждое событие.
 */
const BATCH_MS = 300;

const NONE: CommentItem[] = [];

export type CommentsState = {
  /** Самые новые первыми: свои неотправленные, затем подтверждённые. */
  comments: CommentItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Догружает страницу старее; промис — когда она легла в кеш (или нечего грузить). */
  loadMore: () => Promise<void>;
  send: (text: string, media?: MediaLibraryItem[], replies?: LiveQuote[]) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  /**
   * Тап по реакции: та же, что стоит, — снять, другая — поставить. Ряд —
   * догадка для мгновенного отклика по участию в чате; решит база.
   */
  react: (comment: CommentItem, emoji: string) => void;
  retry: (localId: string) => void;
  /** Своё неотправленное — убрать с экрана; на сервер ничего не уходит. */
  discard: (localId: string) => void;
  saveEdit: (original: CommentItem, result: EditResult) => void;
  /** Удаляет свой для всех. С экрана сразу; отказ сервера возвращает на место и пробрасывается. */
  remove: (comment: CommentItem) => Promise<void>;
};

/**
 * Комментарии к одному сообщению — всё, что нужно панели:
 * подтверждённые сервером — в кеше TanStack Query, свои неотправленные — в
 * Zustand (`commentOutbox`), правки в полёте — наложением поверх, свежесть —
 * топиком Realtime этого сообщения, открытым всем.
 */
export function useComments(
  messageId: string,
  chatId: string,
  currentUserId: string | null,
  amMember = false,
): CommentsState {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  const { data: me } = useMyProfile();
  const outbox = useOutboxComments(messageId);
  const pendingEdits = usePendingEditsOf(commentThreadKey(messageId));
  const pendingReactions = usePendingReactionMap();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const wasOfflineRef = useRef(false);

  const { data, isPending, error } = useQuery({
    queryKey: commentsQueryKey(messageId),
    queryFn: () => loadComments(queryClient, messageId),
    refetchOnReconnect: false,
  });

  const context = useMemo<CommentSendContext>(
    () => ({
      queryClient,
      messageId,
      chatId,
      currentUserId,
      me: { name: me?.displayName ?? null, avatarUrl: me?.avatarUrl ?? null },
    }),
    [chatId, currentUserId, me, messageId, queryClient],
  );

  // ----------------------------------------------------------------- Realtime
  useEffect(() => {
    let pullNewer = false;
    const ids = new Set<string>();
    const reacted = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const batch = { pullNewer, ids: [...ids] };
      const reactedIds = [...reacted];

      pullNewer = false;
      ids.clear();
      reacted.clear();
      timer = null;

      if (reactedIds.length > 0) {
        syncCommentReactions(queryClient, messageId, reactedIds).catch(() => undefined);
      }

      if (!batch.pullNewer && batch.ids.length === 0) return;

      // Число в шапке панели живёт на сообщении — перечитываем его той же пачкой.
      void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
      // Не вышло — дочитаем при следующем событии или переподключении.
      syncComments(queryClient, messageId, batch).catch(() => undefined);
    };

    const schedule = () => {
      if (!timer) timer = setTimeout(flush, BATCH_MS);
    };

    const unsubscribe = subscribeToComments(messageId, {
      onAdded: () => {
        pullNewer = true;
        schedule();
      },
      onDeleted: (id) => {
        ids.add(id);
        schedule();
      },
      onEdited: (id) => {
        ids.add(id);
        schedule();
      },
      onReactionsChanged: (id) => {
        reacted.add(id);
        schedule();
      },
      onTargetChanged: () => {
        void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
      },
      onReconnected: () => {
        void queryClient.invalidateQueries({ queryKey: commentsQueryKey(messageId) });
        void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
      },
    });

    return () => {
      unsubscribe();

      if (timer) clearTimeout(timer);
    };
  }, [messageId, queryClient]);

  // Связь вернулась — дописываем то, что не ушло: человек уже нажал «отправить».
  useEffect(() => {
    if (connection !== 'online') {
      wasOfflineRef.current = true;
      return;
    }

    if (!wasOfflineRef.current) return;

    wasOfflineRef.current = false;

    for (const item of outboxComments(messageId)) {
      const outgoing = item.status === 'failed' ? outgoingOf(item) : null;

      if (outgoing && item.localId) void deliverComment(context, item.localId, outgoing);
    }
  }, [connection, context, messageId]);

  // ------------------------------------------------------------------ список
  const confirmed = useMemo(() => {
    const items = data?.items ?? NONE;

    if (Object.keys(pendingEdits).length === 0 && Object.keys(pendingReactions).length === 0) {
      return items;
    }

    // Наложение правки — копия того же комментария с новой версией
    // содержимого; реакции у неё — из кеша. Моя неподтверждённая реакция —
    // поверх подтверждённых счётчиков.
    return items.map((item) => {
      const edited = pendingEdits[item.id] as CommentItem | undefined;
      const base = edited ? { ...edited, reactions: item.reactions } : item;
      const intent = pendingReactions[item.id];

      return intent ? { ...base, reactions: withMyReaction(base.reactions, intent) } : base;
    });
  }, [data, pendingEdits, pendingReactions]);

  const comments = useMemo(() => {
    if (outbox.length === 0) return confirmed;

    const known = new Set(confirmed.map((item) => item.id));
    const pending = outbox.filter((item) => !known.has(item.id));

    return pending.length === 0 ? confirmed : [...pending, ...confirmed];
  }, [confirmed, outbox]);

  const loadMore = useCallback(() => {
    const cursor = readComments(queryClient, messageId)?.nextCursor;

    if (!cursor || loadingMoreRef.current) return Promise.resolve();

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    return listComments(messageId, { cursor })
      .then((page) =>
        updateComments(queryClient, messageId, (current) => ({
          ...mergeComments(current, page.items),
          nextCursor: page.nextCursor,
        })),
      )
      // Не вышло — следующая прокрутка вверх попробует снова.
      .catch(() => undefined)
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [messageId, queryClient]);

  const remove = useCallback(
    async (comment: CommentItem) => {
      updateComments(queryClient, messageId, (page) => removeComments(page, new Set([comment.id])));

      try {
        await deleteComment(comment.id);
      } catch (cause) {
        updateComments(queryClient, messageId, (page) => ({
          ...page,
          items: [...page.items, comment].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)),
        }));
        throw cause;
      }

      void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
    },
    [messageId, queryClient],
  );

  return {
    comments,
    isLoading: isPending,
    isLoadingMore,
    hasMore: Boolean(data?.nextCursor),
    error: data ? null : describeLoadError(error, 'Не удалось загрузить комментарии'),
    loadMore,
    send: useCallback(
      (text: string, media: MediaLibraryItem[] = [], replies: LiveQuote[] = []) =>
        sendCommentPost(context, text, media, replies),
      [context],
    ),
    sendVoice: useCallback(
      (voice: LocalMedia, replies: LiveQuote[] = []) => sendCommentVoice(context, voice, replies),
      [context],
    ),
    react: useCallback(
      (comment: CommentItem, emoji: string) =>
        sendReaction(
          queryClient,
          comment.id,
          { emoji: nextReaction(comment.reactions.mine, emoji), audience: audienceOf(amMember) },
          'comment',
        ),
      [amMember, queryClient],
    ),
    retry: useCallback((localId: string) => retryComment(context, localId), [context]),
    discard: useCallback((localId: string) => discardComment(messageId, localId), [messageId]),
    saveEdit: useCallback(
      (original: CommentItem, result: EditResult) =>
        void saveCommentEdit({ queryClient, messageId, currentUserId }, original, result),
      [currentUserId, messageId, queryClient],
    ),
    remove,
  };
}
