// Отправка из листа «Кому переслать»: во все выбранные чаты — теми же
// исходящими, что и раньше (островок встаёт сразу, упавший повторяется уже в
// том чате), и в «Сохранённые» — отдельным сохранением, мимо исходящих.

import type { QueryClient } from '@tanstack/react-query';

import type { SaveOptions } from '@/api/saved';
import {
  batchSize,
  forwardBatches,
  type ForwardBatch,
  type ForwardPick,
} from '@/features/chats/composerDraftStore';
import {
  sendCommentForward,
  sendForward,
  sendNoteForward,
} from '@/features/chats/messages/delivery';
import { showNotice } from '@/features/notifications/alertsStore';
import { saveToSaved, type SaveRequest } from '@/features/saved/saveToSaved';

export type ForwardTargets = {
  chatIds: string[];
  /** «Сохранённые» выбраны — с тегами и «Посмотреть позже»; нет — `null`. */
  saved: SaveOptions | null;
};

const COUNT_GENITIVE = ['', 'одного', 'двух', 'трёх', 'четырёх'];

/** «оригинал одного удалён», «оригиналы двух удалены». */
function skippedText(skipped: number): string {
  const count = COUNT_GENITIVE[skipped] ?? String(skipped);

  return skipped === 1 ? `оригинал ${count} удалён` : `оригиналы ${count} удалены`;
}

/**
 * Что написать после отправки. `skipped` — сколько выбранного не переслано
 * (оригинал удалён), `total` — сколько выбирали.
 */
export function forwardNotice(chats: number, saved: boolean, skipped = 0, total = 0): string {
  if (skipped > 0 && chats > 0) {
    return `Переслано ${total - skipped} из ${total}: ${skippedText(skipped)}`;
  }

  if (chats > 0 && saved) return 'Переслано и сохранено';

  return saved ? 'Сохранено' : 'Переслано';
}

function saveRequestOf(batch: ForwardBatch, options: SaveOptions): SaveRequest {
  // Заметка в «Сохранённые» — копией заметки: оригинала в чате у неё нет.
  if ('notes' in batch) {
    return { type: 'notes', savedIds: batch.notes.map((note) => note.savedId), options };
  }

  return 'comments' in batch
    ? { type: 'comments', commentIds: batch.comments.map((comment) => comment.id), options }
    : {
        type: 'messages',
        // Облачко островка сохраняется оригиналом, как его видно в этом чате.
        sourceChatId: batch.sourceChat.id,
        messageIds: batch.items.map((item) => item.original.id),
        options,
      };
}

/**
 * Подпись уходит в каждый чат отдельным сообщением перед пересланным — один
 * раз, перед первой пачкой; в «Сохранённые» — нет. Пачки — по порядку: по
 * островку на чат-источник, пересланные комментарии и свои заметки.
 */
export function sendForwardPick(
  queryClient: QueryClient,
  currentUserId: string | null,
  pick: ForwardPick,
  targets: ForwardTargets,
  text: string,
) {
  const batches = forwardBatches(pick);

  for (const chatId of targets.chatIds) {
    const context = { queryClient, chatId, currentUserId };

    // Облачка всех пачек встают сразу, а на сервер пачки уходят по очереди:
    // номер в переписке выдаётся по приходу, и подпись осталась бы не первой.
    let previous: Promise<void> = Promise.resolve();

    batches.forEach((batch, index) => {
      const caption = index === 0 ? text : '';

      previous = (
        'comments' in batch
          ? sendCommentForward(context, caption, batch.comments, previous)
          : 'notes' in batch
            ? sendNoteForward(context, caption, batch.notes, previous)
            : sendForward(context, caption, batch.sourceChat, batch.items, previous)
      ).delivered;
    });
  }

  const skipped = 'batches' in pick ? pick.skipped : 0;
  const total = skipped + batches.reduce((sum, batch) => sum + batchSize(batch), 0);

  // Неудача сохранения сменит это уведомление на «Не удалось сохранить».
  showNotice(forwardNotice(targets.chatIds.length, targets.saved !== null, skipped, total));

  const { saved } = targets;

  if (saved) {
    for (const batch of batches) void saveToSaved(queryClient, saveRequestOf(batch, saved));
  }
}
