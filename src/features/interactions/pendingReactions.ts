// Мои реакции, которые сервер ещё не подтвердил. Как и правки, — клиентское
// состояние: в кеше истории лежат счётчики, подтверждённые базой, а желаемая
// реакция накладывается поверх, пока едет. Отказ сервера — снятие наложения:
// облачко само возвращается к тому, что знает база.
//
// Ключ — сообщение, а не чат: одно сообщение показано и в своём чате, и в
// островках других, и моя реакция должна появиться сразу везде.

import { create } from 'zustand';

import type { ReactionIntent } from '@/features/interactions/reactionState';

type PendingReactionsState = {
  /** messageId → какой я хочу видеть свою реакцию. */
  byMessage: Record<string, ReactionIntent>;
};

export const usePendingReactions = create<PendingReactionsState>(() => ({ byMessage: {} }));

/** Все мои неподтверждённые реакции — наложение для любой переписки. */
export function usePendingReactionMap(): Record<string, ReactionIntent> {
  return usePendingReactions((state) => state.byMessage);
}

export function readPendingReaction(messageId: string): ReactionIntent | undefined {
  return usePendingReactions.getState().byMessage[messageId];
}

export function setPendingReaction(messageId: string, intent: ReactionIntent) {
  usePendingReactions.setState((state) => ({
    byMessage: { ...state.byMessage, [messageId]: intent },
  }));
}

/** Снимает наложение — только если это всё ещё то же желание: новый тап мог прийти, пока ехал прежний. */
export function clearPendingReaction(messageId: string, intent?: ReactionIntent) {
  usePendingReactions.setState((state) => {
    const current = state.byMessage[messageId];

    if (!current || (intent && current !== intent)) return state;

    const { [messageId]: _removed, ...rest } = state.byMessage;

    return { byMessage: rest };
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
  usePendingReactions.setState({ byMessage: {} });
  reactionsInFlight.clear();
}
