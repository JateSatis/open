// Правки своих сообщений, которые сервер ещё не подтвердил. Как и исходящие —
// клиентское состояние, поэтому в Zustand: в кеше истории лежит то, что
// подтвердила база, а новая версия накладывается поверх, пока едет. Отказ
// сервера — это просто снятие наложения: облачко само возвращается к
// прежней версии, откатывать в кеше нечего.

import { create } from 'zustand';

import type { ChatMessage } from '@/features/chats/messages/types';

type PendingEditsState = {
  /** chatId → messageId → версия, которая сейчас сохраняется. */
  byChat: Record<string, Record<string, ChatMessage>>;
};

const EMPTY: Record<string, ChatMessage> = {};

export const usePendingEdits = create<PendingEditsState>(() => ({ byChat: {} }));

export function usePendingEditsOf(chatId: string): Record<string, ChatMessage> {
  return usePendingEdits((state) => state.byChat[chatId] ?? EMPTY);
}

export function setPendingEdit(chatId: string, message: ChatMessage) {
  usePendingEdits.setState((state) => ({
    byChat: {
      ...state.byChat,
      [chatId]: { ...(state.byChat[chatId] ?? EMPTY), [message.id]: message },
    },
  }));
}

/**
 * Снимает наложение — только если это всё ещё та же правка: повторная правка
 * того же сообщения могла начаться, пока первая ехала.
 */
export function clearPendingEdit(chatId: string, message: ChatMessage) {
  usePendingEdits.setState((state) => {
    const current = state.byChat[chatId];

    if (current?.[message.id] !== message) return state;

    const { [message.id]: _removed, ...rest } = current;
    const byChat = { ...state.byChat };

    if (Object.keys(rest).length === 0) delete byChat[chatId];
    else byChat[chatId] = rest;

    return { byChat };
  });
}

/** Выход из аккаунта. */
export function resetPendingEdits() {
  usePendingEdits.setState({ byChat: {} });
}
