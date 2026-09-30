import { create } from 'zustand';

import { canCommentOn } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Какие комментарии открыты: к какому сообщению и, если известно, из какого чата. */
export type CommentsPanelTarget = {
  messageId: string;
  /** Чат, из переписки которого открыли, — его кеш сразу даёт облачко сверху. */
  chatId?: string;
};

const usePanelStore = create<{ target: CommentsPanelTarget | null }>(() => ({ target: null }));

/**
 * Открывает панель комментариев к сообщению. Одна функция на всё
 * приложение: переписка открывает её по кружку у облачка, лента — у
 * фрагмента переписки.
 */
export function openComments(messageId: string, chatId?: string) {
  usePanelStore.setState({ target: { messageId, chatId } });
}

export function closeComments() {
  usePanelStore.setState({ target: null });
}

export function useCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore((state) => state.target);
}

/**
 * Кружок комментариев у облачка переписки: число и открытие панели. Нет —
 * нет и кружка (неотправленное, системное). У копии облачка в меню кружок
 * только показывает число.
 */
export function commentsEntry(
  message: ChatMessage,
  chatId: string,
  interactive: boolean,
): { count: number; onPress?: () => void } | undefined {
  if (!canCommentOn(message)) return undefined;

  return {
    count: message.commentsCount,
    onPress: interactive ? () => openComments(message.id, chatId) : undefined,
  };
}
