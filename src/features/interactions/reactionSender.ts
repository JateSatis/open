// Отправка своей реакции. Вне компонентов — как и отправка сообщений: закрыл
// чат, а реакция всё равно доезжает.
//
// На одно сообщение в полёте не больше одного запроса. Быстрые тапы только
// меняют желаемое в наложении, а очередь, дождавшись ответа, отправляет
// последнее желаемое: запросы не обгоняют друг друга по дороге, и в базе
// остаётся то, что человек выбрал последним.

import type { QueryClient } from '@tanstack/react-query';

import { setCommentReaction } from '@/api/comments';
import { setMessageReaction, type MyReaction } from '@/api/reactions';
import { mapOriginals } from '@/features/chats/islands/islandCache';
import { updateAllHistories } from '@/features/chats/messages/historyCache';
import {
  clearPendingReaction,
  reactionsInFlight,
  readPendingReaction,
  setPendingReaction,
} from '@/features/interactions/pendingReactions';
import type { CommentsPage } from '@/features/interactions/comments/commentsCache';
import { replaceMine, type ReactionIntent } from '@/features/interactions/reactionState';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

/**
 * Подтверждённое базой — в кеш истории, везде, где сообщение показано: в
 * своём чате и в островках других. Ряд берётся из ответа: он мог разойтись с
 * догадкой клиента, например, заявку приняли, пока экран этого не знал. Чужие
 * реакции, пришедшие тем временем, догонит событие канала.
 */
function confirmMessage(queryClient: QueryClient, messageId: string, mine: MyReaction | null) {
  updateAllHistories(queryClient, (history) => {
    let changed = false;

    const items = history.items.map((message) => {
      const own =
        message.id === messageId
          ? { ...message, reactions: replaceMine(message.reactions, mine) }
          : message;
      const next = mapOriginals(own, (original) =>
        original.id === messageId
          ? { ...original, reactions: replaceMine(original.reactions, mine) }
          : original,
      );

      if (next !== message) changed = true;

      return next;
    });

    return changed ? { ...history, items } : history;
  });
}

/** Подтверждённая реакция на комментарий — во все загруженные ветки, где он есть. */
function confirmComment(queryClient: QueryClient, commentId: string, mine: MyReaction | null) {
  queryClient.setQueriesData<CommentsPage>({ queryKey: ['comments'] }, (page) => {
    if (!page?.items.some((item) => item.id === commentId)) return page;

    return {
      ...page,
      items: page.items.map((item) =>
        item.id === commentId ? { ...item, reactions: replaceMine(item.reactions, mine) } : item,
      ),
    };
  });
}

/** Куда ставится реакция: сообщение или комментарий. У обоих одна очередь и одно наложение. */
export type ReactionTarget = 'message' | 'comment';

const TARGETS: Record<
  ReactionTarget,
  {
    send: (id: string, emoji: string | null) => Promise<MyReaction | null>;
    confirm: (queryClient: QueryClient, id: string, mine: MyReaction | null) => void;
  }
> = {
  message: { send: setMessageReaction, confirm: confirmMessage },
  comment: { send: setCommentReaction, confirm: confirmComment },
};

async function drain(queryClient: QueryClient, messageId: string, target: ReactionTarget) {
  const { send, confirm } = TARGETS[target];

  reactionsInFlight.add(messageId);

  try {
    for (;;) {
      const wanted = readPendingReaction(messageId);

      if (!wanted) return;

      const mine = await send(messageId, wanted.emoji);

      confirm(queryClient, messageId, mine);

      // Пока ехал запрос, человек передумал — отправляем новое желаемое.
      if (readPendingReaction(messageId) !== wanted) continue;

      clearPendingReaction(messageId, wanted);
      return;
    }
  } catch (cause) {
    // Откат — снятие наложения: облачко возвращается к тому, что знает база.
    clearPendingReaction(messageId);
    showNotice(
      isNetworkError(cause)
        ? 'Не удалось поставить реакцию: нет связи'
        : 'Не удалось поставить реакцию',
      'error',
    );
  } finally {
    reactionsInFlight.delete(messageId);
  }
}

/**
 * Ставит, меняет или снимает мою реакцию на сообщение или комментарий. На
 * экране — сразу, наложением, везде, где цель показана; в базу — очередью
 * (см. выше). Ключ наложения — id цели: id сообщений и комментариев не
 * пересекаются.
 */
export function sendReaction(
  queryClient: QueryClient,
  id: string,
  intent: ReactionIntent,
  target: ReactionTarget = 'message',
) {
  setPendingReaction(id, intent);

  if (!reactionsInFlight.has(id)) void drain(queryClient, id, target);
}

