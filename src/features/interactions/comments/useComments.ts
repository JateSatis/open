import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deleteComment, listThreadRoots, subscribeToComments } from '@/api/comments';
import { outgoingOf } from '@/features/chats/messages/delivery';
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
import {
  asDeletedRoot,
  commentThreadKey,
  type CommentItem,
} from '@/features/interactions/comments/commentItem';
import { outboxComments, useOutboxComments } from '@/features/interactions/comments/commentOutbox';
import {
  appendRoots,
  commentsKey,
  readRoots,
  rootsInOrder,
  rootsKey,
  updateAllComments,
  updateRoots,
  type RootsPage,
} from '@/features/interactions/comments/commentsCache';
import {
  loadRoots,
  resyncComments,
  syncCommentReactions,
  syncComments,
} from '@/features/interactions/comments/commentSync';
import { commentTargetQueryKey } from '@/features/interactions/comments/useCommentTarget';
import { usePendingReactionMap } from '@/features/interactions/pendingReactions';
import { sendReaction } from '@/features/interactions/reactionSender';
import {
  audienceOf,
  nextReaction,
  withMyReaction,
} from '@/features/interactions/reactionState';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';
import { useMyProfile } from '@/features/profile/queries';
import { describeLoadError } from '@/lib/network';

/**
 * Столько копить события, прежде чем перечитать: под горячим сообщением
 * комментарии сыплются пачками, и база получает запрос на пачку, а не на
 * каждое событие.
 */
const BATCH_MS = 300;

const NONE: CommentItem[] = [];
const NO_REPLIES: ReadonlyMap<string, CommentItem[]> = new Map();

export type CommentsState = {
  /** Верх на экране: свои неотправленные, свои отправленные за это открытие, затем по рангу. */
  roots: CommentItem[];
  /** Свои неотправленные ответы — по тредам, в конец треда. */
  pendingReplies: ReadonlyMap<string, CommentItem[]>;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Догружает следующую страницу верха; промис — когда она легла в кеш (или нечего грузить). */
  loadMore: () => Promise<void>;
  /** С `threadRootId` — ответ в этот тред, с цитатами или без; без него — наверх. */
  send: (
    text: string,
    media?: MediaLibraryItem[],
    replies?: LiveQuote[],
    threadRootId?: string | null,
  ) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[], threadRootId?: string | null) => void;
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
  /** Правки и мои реакции в полёте — поверх загруженного. Для тредов. */
  overlay: (items: CommentItem[]) => CommentItem[];
};

/** Правки и мои реакции в полёте поверх подтверждённых сервером. */
function useOverlay(messageId: string) {
  const pendingEdits = usePendingEditsOf(commentThreadKey(messageId));
  const pendingReactions = usePendingReactionMap();

  return useCallback(
    (items: CommentItem[]) => {
      if (Object.keys(pendingEdits).length === 0 && Object.keys(pendingReactions).length === 0) {
        return items;
      }

      let changed = false;
      const next = items.map((item) => {
        const edited = pendingEdits[item.id] as CommentItem | undefined;
        const intent = pendingReactions[item.id];

        if (!edited && !intent) return item;

        changed = true;
        // Наложение правки — копия того же комментария с новой версией
        // содержимого; реакции и тред у неё — из кеша.
        const base = edited
          ? { ...edited, reactions: item.reactions, repliesCount: item.repliesCount }
          : item;

        return intent ? { ...base, reactions: withMyReaction(base.reactions, intent) } : base;
      });

      return changed ? next : items;
    },
    [pendingEdits, pendingReactions],
  );
}

/**
 * Комментарии к одному сообщению — всё, что нужно панели: подтверждённые
 * сервером — в кеше TanStack Query (верх и треды), свои неотправленные — в
 * Zustand (`commentOutbox`), правки в полёте — наложением поверх, свежесть —
 * топиком Realtime этого сообщения, открытым всем.
 *
 * Кеш живёт одно открытие панели: при закрытии он забывается, и следующее
 * открытие читает свежий ранг. На глазах порядок не меняется.
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
  const overlay = useOverlay(messageId);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const wasOfflineRef = useRef(false);
  const meRef = useRef(currentUserId);

  useEffect(() => {
    meRef.current = currentUserId;
  }, [currentUserId]);

  const { data, isPending, error } = useQuery({
    queryKey: rootsKey(messageId),
    queryFn: () => loadRoots(messageId),
    // Порядок верха меняется только новым открытием: сами по себе страницы не перечитываются.
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // Панель закрыта — кеш забывается: следующее открытие — со свежим рангом.
  useEffect(
    () => () => queryClient.removeQueries({ queryKey: commentsKey(messageId) }),
    [messageId, queryClient],
  );

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
    const added = new Set<string>();
    const changed = new Set<string>();
    const reacted = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const batch = { added: [...added], changed: [...changed] };
      const reactedIds = [...reacted];

      added.clear();
      changed.clear();
      reacted.clear();
      timer = null;

      if (reactedIds.length > 0) {
        syncCommentReactions(queryClient, messageId, reactedIds).catch(() => undefined);
      }

      if (batch.added.length === 0 && batch.changed.length === 0) return;

      // Число в шапке панели живёт на сообщении — перечитываем его той же пачкой.
      void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
      // Не вышло — дочитаем при следующем событии или переподключении.
      syncComments(queryClient, messageId, meRef.current, batch).catch(() => undefined);
    };

    const schedule = () => {
      if (!timer) timer = setTimeout(flush, BATCH_MS);
    };

    const unsubscribe = subscribeToComments(messageId, {
      onAdded: (id) => {
        added.add(id);
        schedule();
      },
      onDeleted: (id) => {
        changed.add(id);
        schedule();
      },
      onEdited: (id) => {
        changed.add(id);
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
        resyncComments(queryClient, messageId, meRef.current).catch(() => undefined);
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

      if (outgoing && item.localId) {
        void deliverComment(context, item.localId, outgoing, item.threadRootId);
      }
    }
  }, [connection, context, messageId]);

  // ------------------------------------------------------------------ список
  const confirmed = useMemo(() => overlay(data ? rootsInOrder(data) : NONE), [data, overlay]);

  const { pendingRoots, pendingReplies } = useMemo(() => {
    if (outbox.length === 0) return { pendingRoots: NONE, pendingReplies: NO_REPLIES };

    const roots: CommentItem[] = [];
    const replies = new Map<string, CommentItem[]>();

    for (const item of outbox) {
      if (!item.threadRootId) {
        roots.push(item);
        continue;
      }

      // В треде — по порядку: в исходящих новые вперёд.
      replies.set(item.threadRootId, [item, ...(replies.get(item.threadRootId) ?? [])]);
    }

    return { pendingRoots: roots, pendingReplies: replies };
  }, [outbox]);

  const roots = useMemo(() => {
    if (pendingRoots.length === 0) return confirmed;

    const known = new Set(confirmed.map((item) => item.id));
    const pending = pendingRoots.filter((item) => !known.has(item.id));

    return pending.length === 0 ? confirmed : [...pending, ...confirmed];
  }, [confirmed, pendingRoots]);

  const loadMore = useCallback(() => {
    const cursor = readRoots(queryClient, messageId)?.nextCursor;

    if (!cursor || loadingMoreRef.current) return Promise.resolve();

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    return listThreadRoots(messageId, { cursor })
      .then((page) =>
        updateRoots(queryClient, messageId, (current: RootsPage) =>
          appendRoots(current, page.items, page.nextCursor),
        ),
      )
      // Не вышло — следующая прокрутка вниз попробует снова.
      .catch(() => undefined)
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [messageId, queryClient]);

  const remove = useCallback(
    async (comment: CommentItem) => {
      // Откат — к тому, что было в кеше до удаления: и верх, и треды.
      const snapshot = queryClient.getQueriesData({ queryKey: commentsKey(messageId) });

      updateAllComments(queryClient, messageId, (item) => {
        if (item.id === comment.id) {
          return !item.threadRootId && item.repliesCount > 0 ? asDeletedRoot(item) : null;
        }

        if (item.id !== comment.threadRootId) return item;

        const repliesCount = Math.max(0, item.repliesCount - 1);

        // Корень-заглушка без ответов уходит вместе с последним.
        return item.deleted && repliesCount === 0 ? null : { ...item, repliesCount };
      });

      try {
        await deleteComment(comment.id);
      } catch (cause) {
        for (const [key, page] of snapshot) queryClient.setQueryData(key, page);
        throw cause;
      }

      void queryClient.invalidateQueries({ queryKey: commentTargetQueryKey(messageId) });
    },
    [messageId, queryClient],
  );

  return {
    roots,
    pendingReplies,
    isLoading: isPending,
    isLoadingMore,
    hasMore: Boolean(data?.nextCursor),
    error: data ? null : describeLoadError(error, 'Не удалось загрузить комментарии'),
    loadMore,
    send: useCallback(
      (
        text: string,
        media: MediaLibraryItem[] = [],
        replies: LiveQuote[] = [],
        threadRootId: string | null = null,
      ) => sendCommentPost(context, text, media, replies, threadRootId),
      [context],
    ),
    sendVoice: useCallback(
      (voice: LocalMedia, replies: LiveQuote[] = [], threadRootId: string | null = null) =>
        sendCommentVoice(context, voice, replies, threadRootId),
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
    overlay,
  };
}
