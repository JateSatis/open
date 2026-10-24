import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { getSavedSource, type SavedMessage } from '@/api/saved';
import { showNotice } from '@/features/notifications/alertsStore';
import { openPopViewer } from '@/features/pops/openPopViewer';

/**
 * Тап по источнику копии — к оригиналу: чат, прокрученный к сообщению (оно
 * подсвечено), у комментария — шит комментариев на нём. Есть ли ещё оригинал,
 * решает ответ сервера: удалён — открыть чат и сказать; недоступен и чат —
 * только сказать. Чат постов канала маршрут чата сам переводит на экран
 * канала, передав прыжок дальше.
 */
export function useOpenSavedSource() {
  const router = useRouter();

  return useCallback(
    (saved: SavedMessage) => {
      void getSavedSource(saved.id)
        .then((source) => {
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
            openPopViewer(source.popChannelId, source.popId, { focusCommentId: source.commentId });
            return;
          }

          const jump =
            source.messageId && source.seq !== null
              ? { jumpTo: source.messageId, jumpSeq: String(source.seq) }
              : {};
          const comments =
            source.commentId && source.messageId
              ? { comments: source.messageId, comment: source.commentId }
              : {};

          router.push({
            pathname: '/chats/[chatId]',
            params: { chatId: source.chatId, ...jump, ...comments, jumpKey: String(Date.now()) },
          });
        })
        .catch(() => showNotice('Не удалось открыть оригинал', 'error'));
    },
    [router],
  );
}
