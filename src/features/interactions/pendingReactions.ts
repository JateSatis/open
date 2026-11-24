// Мои реакции, которые сервер ещё не подтвердил. Как и правки, — клиентское
// состояние: в кеше истории лежат счётчики, подтверждённые базой, а желаемая
// реакция накладывается поверх, пока едет. Отказ сервера — снятие наложения:
// облачко само возвращается к тому, что знает база.
//
// Ключ — сообщение, а не чат: одно сообщение показано и в своём чате, и в
// островках других, и моя реакция должна появиться сразу везде.

import { requestClient } from '@/api/requestClient';
import { perClient } from '@/api/perClient';
import { createAccountStore } from '@/features/auth/accountStore';

import type { ReactionIntent } from '@/features/interactions/reactionState';

type PendingReactionsState = {
  /** messageId → какой я хочу видеть свою реакцию. */
  byMessage: Record<string, ReactionIntent>;
};

export const usePendingReactions = createAccountStore<PendingReactionsState>(() => ({ byMessage: {} }));

/** Все мои неподтверждённые реакции — наложение для любой переписки. */
export function usePendingReactionMap(): Record<string, ReactionIntent> {
  return usePendingReactions((state) => state.byMessage);
}

export function readPendingReaction(messageId: string): ReactionIntent | undefined {
  return usePendingReactions.getState().byMessage[messageId];
}

export function setPendingReaction(messageId: string, intent: ReactionIntent, api = requestClient()) {
  usePendingReactions.forClient(api).setState((state) => ({
    byMessage: { ...state.byMessage, [messageId]: intent },
  }));
}

/** Снимает наложение — только если это всё ещё то же желание: новый тап мог прийти, пока ехал прежний. */
export function clearPendingReaction(messageId: string, intent?: ReactionIntent, api = requestClient()) {
  usePendingReactions.forClient(api).setState((state) => {
    const current = state.byMessage[messageId];

    if (!current || (intent && current !== intent)) return state;

    const { [messageId]: _removed, ...rest } = state.byMessage;

    return { byMessage: rest };
  });
}

/**
 * Выход из аккаунта. Ответ на запрос прежнего пользователя может так и не
 * прийти — очередь не должна считать его сообщения занятыми навсегда.
 */
export const reactionQueues = perClient(() => new Map<string, ReactionIntent>());

export function resetPendingReactions() {
  reactionQueues(requestClient()).clear();
  usePendingReactions.setState({ byMessage: {} });
}
