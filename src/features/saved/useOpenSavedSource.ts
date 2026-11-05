import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { commentFocusQueryKey, fetchComment } from '@/api/comments';
import { getSavedSource, type SavedMessage } from '@/api/saved';
import { showNotice } from '@/features/notifications/alertsStore';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { nextJumpKey } from '@/features/chats/jumpParams';

/**
 * Тап по источнику копии — к оригиналу: чат, прокрученный к сообщению (оно
 * подсвечено), у комментария — шит комментариев на нём. Есть ли ещё оригинал,
 * решает ответ сервера: удалён — открыть чат и сказать; недоступен и чат —
 * только сказать. Чат постов канала маршрут чата сам переводит на экран
 * канала, передав прыжок дальше.
 */
export function useOpenSavedSource() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (saved: SavedMessage) => {
      const comment = saved.sourceCommentId
        ? fetchComment(saved.sourceCommentId).catch(() => null)
        : Promise.resolve(null);

      void Promise.all([getSavedSource(saved.id), comment])
        .then(([source, focused]) => {
          if (focused) queryClient.setQueryData(commentFocusQueryKey(focused.id), focused);

          if (source.state === 'chat_gone') {
            showNotice('Оригинал удалён');
            return;
          }

          if (source.state === 'original_gone') {
            router.push({ pathname: '/chats/[chatId]', params: { chatId: source.chatId } });
            showNotice('Оригинал удалён');
            return;
          }

          if (source.commentId && source.popId && source.popChannelId) {
            openPopViewer(source.popChannelId, source.popId, {
              focusCommentId: source.commentId,
              focusRootId:
                focused?.id === source.commentId
                  ? focused.commentThreadRootId ?? undefined
                  : undefined,
              requestId: nextJumpKey(),
            });
            return;
          }

          const jump =
            source.messageId && source.seq !== null
              ? { jumpTo: source.messageId, jumpSeq: String(source.seq) }
              : {};
          const comments =
            source.commentId && source.messageId
              ? {
                  comments: source.messageId,
                  comment: source.commentId,
                  ...(focused?.id === source.commentId && focused.commentThreadRootId
                    ? { commentRoot: focused.commentThreadRootId }
                    : {}),
                }
              : {};

          closeComments();

          router.push({
            pathname: '/chats/[chatId]',
            params: { chatId: source.chatId, ...jump, ...comments, jumpKey: nextJumpKey() },
          });
        })
        .catch(() => showNotice('Не удалось открыть оригинал', 'error'));
    },
    [queryClient, router],
  );
}
