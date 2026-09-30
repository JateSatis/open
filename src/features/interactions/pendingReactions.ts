// Мои реакции, которые сервер ещё не подтвердил. Как и правки, — клиентское
// состояние: в кеше истории лежат счётчики, подтверждённые базой, а желаемая
// реакция накладывается поверх, пока едет. Отказ сервера — снятие наложения:
// облачко само возвращается к тому, что знает база.

import { create } from 'zustand';

import type { ReactionIntent } from '@/features/interactions/reactionState';

type PendingReactionsState = {
  /** chatId → messageId → какой я хочу видеть свою реакцию. */
  byChat: Record<string, Record<string, ReactionIntent>>;
};

const EMPTY: Record<string, ReactionIntent> = {};

export const usePendingReactions = create<PendingReactionsState>(() => ({ byChat: {} }));

export function usePendingReactionsOf(chatId: string): Record<string, ReactionIntent> {
  return usePendingReactions((state) => state.byChat[chatId] ?? EMPTY);
}

export function readPendingReaction(chatId: string, messageId: string): ReactionIntent | undefined {
  return usePendingReactions.getState().byChat[chatId]?.[messageId];
}

export function setPendingReaction(chatId: string, messageId: string, intent: ReactionIntent) {
  usePendingReactions.setState((state) => ({
    byChat: {
      ...state.byChat,
      [chatId]: { ...(state.byChat[chatId] ?? EMPTY), [messageId]: intent },
    },
  }));
}

/** Снимает наложение — только если это всё ещё то же желание: новый тап мог прийти, пока ехал прежний. */
export function clearPendingReaction(chatId: string, messageId: string, intent?: ReactionIntent) {
  usePendingReactions.setState((state) => {
    const current = state.byChat[chatId];

    if (!current?.[messageId] || (intent && current[messageId] !== intent)) return state;

    const { [messageId]: _removed, ...rest } = current;
    const byChat = { ...state.byChat };

    if (Object.keys(rest).length === 0) delete byChat[chatId];
    else byChat[chatId] = rest;

    return { byChat };
  });
}

/**
 * Сообщения, по которым запрос уже едет: на одно сообщение — не больше
 * одного (см. `reactionSender`). Не часть отображаемого состояния, поэтому
 * не в сторе.
 */
export const reactionsInFlight = new Set<string>();

/**
 * Выход из аккаунта. Ответ на запрос прежнего пользователя может так и не
 * прийти — очередь не должна считать его сообщения занятыми навсегда.
 */
export function resetPendingReactions() {
  usePendingReactions.setState({ byChat: {} });
  reactionsInFlight.clear();
}
