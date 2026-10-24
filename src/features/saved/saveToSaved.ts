// Сохранение в «Сохранённые» из листа пересылки. Не исходящие чата: лист
// закрывается сразу, а сохранение доезжает само. Простая функция, а не
// `useMutation`: лист к ответу уже размонтирован, «Повторить» в уведомлении
// живёт дольше любого экрана, а без сети запрос не встаёт на паузу — срок
// ответа держит `withDeadline`.

import type { QueryClient } from '@tanstack/react-query';

import { saveComments, saveMessages, type SaveOptions } from '@/api/saved';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import { showNotice } from '@/features/notifications/alertsStore';
import { savedQueryKey } from '@/features/saved/keys';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Что сохранить: сообщения, как их видно в чате, или комментарии. */
export type SaveRequest =
  | { type: 'messages'; sourceChatId: string; messageIds: string[]; options: SaveOptions }
  | { type: 'comments'; commentIds: string[]; options: SaveOptions };

const SAVE_DEADLINE_MS = 15_000;

function refresh(queryClient: QueryClient) {
  // Список, счётчик «Посмотреть позже» и счётчики тегов — всё сразу.
  void queryClient.invalidateQueries({ queryKey: savedQueryKey });
}

export async function saveToSaved(
  queryClient: QueryClient,
  request: SaveRequest,
): Promise<boolean> {
  const run =
    request.type === 'messages'
      ? saveMessages(request.sourceChatId, request.messageIds, request.options)
      : saveComments(request.commentIds, request.options);
  // Срок вышел, а сохранение всё же прошло: «Повторить» тогда сохранил бы
  // вторые копии — он больше ничего не делает, а уведомление говорит правду.
  let lateSaved = false;

  try {
    await withDeadline(run, SAVE_DEADLINE_MS, () => {
      lateSaved = true;
      refresh(queryClient);
      showNotice('Сохранено');
    });
    refresh(queryClient);
    return true;
  } catch (cause) {
    if (isNetworkError(cause)) reportRequestFailed();

    showNotice('Не удалось сохранить', 'error', {
      label: 'Повторить',
      run: () => {
        if (!lateSaved) void saveToSaved(queryClient, request);
      },
    });
    return false;
  }
}
