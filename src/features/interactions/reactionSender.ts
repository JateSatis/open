// Отправка своей реакции. Вне компонентов — как и отправка сообщений: закрыл
// чат, а реакция всё равно доезжает.
//
// На одно сообщение в полёте не больше одного запроса. Быстрые тапы только
// меняют желаемое в наложении, а очередь, дождавшись ответа, отправляет
// последнее желаемое: запросы не обгоняют друг друга по дороге, и в базе
// остаётся то, что человек выбрал последним.

import type { QueryClient } from '@tanstack/react-query';

import { setMessageReaction, type MyReaction } from '@/api/reactions';
import { readHistory, updateHistory } from '@/features/chats/messages/historyCache';
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
 * Подтверждённое базой — в кеш истории. Ряд берётся из ответа: он мог
 * разойтись с догадкой клиента, например, заявку приняли, пока экран этого
 * не знал. Чужие реакции, пришедшие тем временем, догонит событие канала.
 */
function confirm(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  mine: MyReaction | null,
) {
  updateHistory(queryClient, chatId, (history) => {
    const index = history.items.findIndex((message) => message.id === messageId);

    if (index < 0) return history;

    const message = history.items[index];
    const reactions = replaceMine(message.reactions, mine);

    if (reactions === message.reactions) return history;

    const items = [...history.items];

    items[index] = { ...message, reactions };
    return { ...history, items };
  });
}

async function drain(queryClient: QueryClient, chatId: string, messageId: string) {
  reactionsInFlight.add(messageId);

  try {
    for (;;) {
      const wanted = readPendingReaction(chatId, messageId);

      if (!wanted) return;

      const mine = await setMessageReaction(messageId, wanted.emoji);

      confirm(queryClient, chatId, messageId, mine);

      // Пока ехал запрос, человек передумал — отправляем новое желаемое.
      if (readPendingReaction(chatId, messageId) !== wanted) continue;

      clearPendingReaction(chatId, messageId, wanted);
      return;
    }
  } catch (cause) {
    // Откат — снятие наложения: облачко возвращается к тому, что знает база.
    clearPendingReaction(chatId, messageId);
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
 * наложением; в базу — очередью (см. выше). Сообщение должно быть загружено:
 * реакцию ставят на то, что видно.
 */
export function sendReaction(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  intent: ReactionIntent,
) {
  if (!readHistory(queryClient, chatId)) return;

  setPendingReaction(chatId, messageId, intent);

  if (!reactionsInFlight.has(messageId)) void drain(queryClient, chatId, messageId);
}
