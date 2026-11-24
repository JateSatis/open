// Правка своего комментария: новая версия в пузыре сразу, загрузка новых
// файлов, `edit_comment`, перенос подтверждённого в кеш. Та же механика,
// что у правки сообщений (`messages/editing`): наложение в `pendingEdits`
// под ключом ветки, отказ — снятие наложения.

import { requestClient } from '@/api/requestClient';
import { notifyManager, type QueryClient } from '@tanstack/react-query';

import { editComment, type CommentSubject } from '@/api/comments';
import { errorCode } from '@/features/chats/messages/delivery';
import {
  optimisticEdit,
  toEditInput,
  uploadEditFiles,
} from '@/features/chats/messages/editing';
import { clearPendingEdit, setPendingEdit } from '@/features/chats/messages/pendingEdits';
import type { EditResult } from '@/features/chats/messages/types';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import { commentThreadKey, type CommentItem } from '@/features/interactions/comments/commentItem';
import { replaceComments } from '@/features/interactions/comments/commentsCache';
import { removeUploadedMedia, storedPaths, type UploadedMedia } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

type EditContext = {
  queryClient: QueryClient;
  subject: CommentSubject;
  currentUserId: string | null;
};

function explainFailure(cause: unknown, subject: CommentSubject, retry: () => void) {
  if (isNetworkError(cause)) {
    reportRequestFailed();
    showNotice('Изменения не сохранены: нет связи', 'error', { label: 'Повторить', run: retry });
    return;
  }

  const code = errorCode(cause);

  if (code === 'P0002') {
    showNotice(
      subject.type === 'pop'
        ? 'Не удалось изменить: комментарий или поп удалены'
        : 'Не удалось изменить: комментарий или сообщение удалены',
      'error',
    );
    return;
  }

  if (code === '42501') {
    showNotice('Этот комментарий изменить нельзя', 'error');
    return;
  }

  showNotice('Изменения не сохранены', 'error', { label: 'Повторить', run: retry });
}

export async function saveCommentEdit(
  context: EditContext,
  original: CommentItem,
  result: EditResult,
  api = requestClient(),
): Promise<void> {
  if (api !== requestClient()) return;
  const { queryClient, subject, currentUserId } = context;
  const targetId = subject.id;
  const key = commentThreadKey(targetId);
  const optimistic = optimisticEdit(original, result);
  const retry = () => void saveCommentEdit(context, original, result, api);

  setPendingEdit(key, optimistic);

  let uploaded: UploadedMedia[] = [];

  try {
    const hasFiles = result.voice?.type === 'new' || result.added.length > 0;

    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadEditFiles(result, currentUserId!, api) : [];

    const saved = await editComment(original.id, toEditInput(result, uploaded), api);
    if (api !== requestClient()) return;
    const previews = optimistic.localPreviews?.some(Boolean)
      ? new Map([[saved.id, optimistic.localPreviews]])
      : undefined;

    replaceComments(queryClient, targetId, [saved], previews);
    notifyManager.schedule(() => clearPendingEdit(key, optimistic));
  } catch (cause) {
    if (api === requestClient()) clearPendingEdit(key, optimistic);

    // Отказ сервера — новые файлы ничьи. При обрыве связи правка могла дойти.
    if (uploaded.length > 0 && !isNetworkError(cause)) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item), undefined, api)));
    }

    if (api === requestClient()) explainFailure(cause, subject, retry);
  }
}
