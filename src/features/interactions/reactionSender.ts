// Отправка своей реакции. Вне компонентов — как и отправка сообщений: закрыл
// чат, а реакция всё равно доезжает.
//
// На одно сообщение в полёте не больше одного запроса. Быстрые тапы только
// меняют желаемое в наложении, а очередь, дождавшись ответа, отправляет
// последнее желаемое: запросы не обгоняют друг друга по дороге, и в базе
// остаётся то, что человек выбрал последним.

import type { QueryClient } from '@tanstack/react-query';

import { setMessageReaction, type MyReaction } from '@/api/reactions';
import { mapOriginals } from '@/features/chats/islands/islandCache';
import { updateAllHistories } from '@/features/chats/messages/historyCache';
import {
  clearPendingReaction,
  reactionsInFlight,
  readPendingReaction,
  setPendingReaction,
} from '@/features/interactions/pendingReactions';
import { replaceMine, type ReactionIntent } from '@/features/interactions/reactionState';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

/**
 * Подтверждённое базой — в кеш истории, везде, где сообщение показано: в
 * своём чате и в островках других. Ряд берётся из ответа: он мог разойтись с
 * догадкой клиента, например, заявку приняли, пока экран этого не знал. Чужие
 * реакции, пришедшие тем временем, догонит событие канала.
 */
function confirm(queryClient: QueryClient, messageId: string, mine: MyReaction | null) {
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

async function drain(queryClient: QueryClient, messageId: string) {
  reactionsInFlight.add(messageId);

  try {
    for (;;) {
      const wanted = readPendingReaction(messageId);

      if (!wanted) return;

      const mine = await setMessageReaction(messageId, wanted.emoji);

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
 * Ставит, меняет или снимает мою реакцию на сообщение. На экране — сразу,
 * наложением, везде, где сообщение показано; в базу — очередью (см. выше).
 */
export function sendReaction(queryClient: QueryClient, messageId: string, intent: ReactionIntent) {
  setPendingReaction(messageId, intent);

  if (!reactionsInFlight.has(messageId)) void drain(queryClient, messageId);
}
