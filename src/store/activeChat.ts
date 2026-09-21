import { useSyncExternalStore } from 'react';

// Какой чат открыт прямо сейчас. Нужно ровно одному потребителю — всплывающему
// уведомлению: показывать карточку о сообщении из чата, который пользователь и
// так читает, бессмысленно и раздражает.

let activeChatId: string | null = null;
const listeners = new Set<() => void>();

export function setActiveChatId(chatId: string | null) {
  if (activeChatId === chatId) return;

  activeChatId = chatId;

  for (const listener of listeners) {
    listener();
  }
}

export function getActiveChatId(): string | null {
  return activeChatId;
}

export function useActiveChatId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getActiveChatId,
    getActiveChatId,
  );
}
