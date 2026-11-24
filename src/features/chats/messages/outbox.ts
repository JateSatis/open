// Исходящие: свои сообщения, которых сервер ещё не подтвердил, — отправляются
// или упали. Это клиентское состояние, а не данные сервера, поэтому оно в
// Zustand, а не в кеше запросов: в историю сообщение попадает только с
// настоящим id, после ответа сервера.
//
// Живёт вне экрана чата: ушёл из переписки посреди отправки — она всё равно
// доедет, а упавшее сообщение дождётся повтора, когда человек вернётся.

import { clientIdentity } from '@/api/perClient';
import { requestClient } from '@/api/requestClient';

import { createAccountStore } from '@/features/auth/accountStore';

import type { ChatMessage } from '@/features/chats/messages/types';

type OutboxState = {
  /** Newest first, как и история. */
  byChat: Record<string, ChatMessage[]>;
};

const EMPTY: ChatMessage[] = [];

export const useOutbox = createAccountStore<OutboxState>(() => ({ byChat: {} }));

function setChat(chatId: string, update: (messages: ChatMessage[]) => ChatMessage[], api = requestClient()) {
  useOutbox.forClient(api).setState((state) => {
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

export function outboxMessages(chatId: string, api = requestClient()): ChatMessage[] {
  return useOutbox.forClient(api).getState().byChat[chatId] ?? EMPTY;
}

export function findOutboxMessage(chatId: string, localId: string, api = requestClient()): ChatMessage | undefined {
  return outboxMessages(chatId, api).find((message) => message.localId === localId);
}

/** Черновики одной отправки, самые новые первыми. */
export function addToOutbox(chatId: string, drafts: ChatMessage[], api = requestClient()) {
  if (api.retired) return;
  const owner = clientIdentity(api);
  const owned = drafts.map(draft => ({ ...draft, deliveryOwner: owner }));
  setChat(chatId, current => [...owned, ...current], api);
}

export function setOutboxStatus(chatId: string, localId: string, status: ChatMessage['status'], api = requestClient()) {
  setChat(chatId, (current) =>
    current.some((message) => message.localId === localId && message.status !== status)
      ? current.map((message) => (message.localId === localId ? { ...message, status } : message))
      : current,
    api,
  );
}

export function removeFromOutbox(chatId: string, localId: string, api = requestClient()) {
  setChat(chatId, (current) =>
    current.some((message) => message.localId === localId)
      ? current.filter((message) => message.localId !== localId)
      : current,
    api,
  );
}

/** Выход из аккаунта: чужие исходящие следующему пользователю не нужны. */
export function resetOutbox() {
  useOutbox.setState({ byChat: {} });
}
