// Отправка из листа «Кому переслать»: во все выбранные чаты — теми же
// исходящими, что и раньше (островок встаёт сразу, упавший повторяется уже в
// том чате), и в «Сохранённые» — отдельным сохранением, мимо исходящих.

import type { QueryClient } from '@tanstack/react-query';

import type { SaveOptions } from '@/api/saved';
import type { ForwardPick } from '@/features/chats/composerDraftStore';
import { sendCommentForward, sendForward } from '@/features/chats/messages/delivery';
import { showNotice } from '@/features/notifications/alertsStore';
import { saveToSaved, type SaveRequest } from '@/features/saved/saveToSaved';

export type ForwardTargets = {
  chatIds: string[];
  /** «Сохранённые» выбраны — с тегами и «Посмотреть позже»; нет — `null`. */
  saved: SaveOptions | null;
};

/** Что написать после отправки. */
export function forwardNotice(chats: number, saved: boolean): string {
  if (chats > 0 && saved) return 'Переслано и сохранено';

  return saved ? 'Сохранено' : 'Переслано';
}

function saveRequestOf(pick: ForwardPick, options: SaveOptions): SaveRequest {
  return 'comments' in pick
    ? { type: 'comments', commentIds: pick.comments.map((comment) => comment.id), options }
    : {
        type: 'messages',
        // Облачко островка сохраняется оригиналом, как его видно в этом чате.
        sourceChatId: pick.sourceChat.id,
        messageIds: pick.items.map((item) => item.original.id),
        options,
      };
}

/**
 * Подпись уходит в каждый чат отдельным сообщением перед пересланным; в
 * «Сохранённые» — нет.
 */
export function sendForwardPick(
  queryClient: QueryClient,
  currentUserId: string | null,
  pick: ForwardPick,
  targets: ForwardTargets,
  text: string,
) {
  for (const chatId of targets.chatIds) {
    const context = { queryClient, chatId, currentUserId };

    if ('comments' in pick) sendCommentForward(context, text, pick.comments);
    else sendForward(context, text, pick.sourceChat, pick.items);
  }

  // Неудача сохранения сменит это уведомление на «Не удалось сохранить».
  showNotice(forwardNotice(targets.chatIds.length, targets.saved !== null));

  if (targets.saved) void saveToSaved(queryClient, saveRequestOf(pick, targets.saved));
}
