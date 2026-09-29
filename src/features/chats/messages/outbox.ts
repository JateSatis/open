// Исходящие: свои сообщения, которых сервер ещё не подтвердил, — отправляются
// или упали. Это клиентское состояние, а не данные сервера, поэтому оно в
// Zustand, а не в кеше запросов: в историю сообщение попадает только с
// настоящим id, после ответа сервера.
//
// Живёт вне экрана чата: ушёл из переписки посреди отправки — она всё равно
// доедет, а упавшее сообщение дождётся повтора, когда человек вернётся.

import { create } from 'zustand';

import type { ChatMessage } from '@/features/chats/messages/types';

type OutboxState = {
  /** Newest first, как и история. */
  byChat: Record<string, ChatMessage[]>;
};

const EMPTY: ChatMessage[] = [];

export const useOutbox = create<OutboxState>(() => ({ byChat: {} }));

function setChat(chatId: string, update: (messages: ChatMessage[]) => ChatMessage[]) {
  useOutbox.setState((state) => {
    const current = state.byChat[chatId] ?? EMPTY;
    const next = update(current);

    if (next === current) return state;

    const byChat = { ...state.byChat };

    if (next.length === 0) delete byChat[chatId];
    else byChat[chatId] = next;

    return { byChat };
  });
}

export function useOutboxMessages(chatId: string): ChatMessage[] {
  return useOutbox((state) => state.byChat[chatId] ?? EMPTY);
}

export function outboxMessages(chatId: string): ChatMessage[] {
  return useOutbox.getState().byChat[chatId] ?? EMPTY;
}

export function findOutboxMessage(chatId: string, localId: string): ChatMessage | undefined {
  return outboxMessages(chatId).find((message) => message.localId === localId);
}

/** Черновики одной отправки, самые новые первыми. */
export function addToOutbox(chatId: string, drafts: ChatMessage[]) {
  setChat(chatId, (current) => [...drafts, ...current]);
}

export function setOutboxStatus(chatId: string, localId: string, status: ChatMessage['status']) {
  setChat(chatId, (current) =>
    current.some((message) => message.localId === localId && message.status !== status)
      ? current.map((message) => (message.localId === localId ? { ...message, status } : message))
      : current,
  );
}

export function removeFromOutbox(chatId: string, localId: string) {
  setChat(chatId, (current) =>
    current.some((message) => message.localId === localId)
      ? current.filter((message) => message.localId !== localId)
      : current,
  );
}

/** Выход из аккаунта: чужие исходящие следующему пользователю не нужны. */
export function resetOutbox() {
  useOutbox.setState({ byChat: {} });
}
