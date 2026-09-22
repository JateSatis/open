import { create } from 'zustand';

// Какой чат открыт прямо сейчас. Нужно ровно одному потребителю — всплывающему
// уведомлению: показывать карточку о сообщении из чата, который пользователь и
// так читает, бессмысленно и раздражает.

type ActiveChatState = {
  activeChatId: string | null;
};

const useActiveChatStore = create<ActiveChatState>(() => ({
  activeChatId: null,
}));

export function setActiveChatId(chatId: string | null) {
  useActiveChatStore.setState({ activeChatId: chatId });
}

export function getActiveChatId(): string | null {
  return useActiveChatStore.getState().activeChatId;
}

export function useActiveChatId(): string | null {
  return useActiveChatStore((state) => state.activeChatId);
}
