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
 * Кнопка комментариев в облачке переписки: число и открытие панели. Нет —
 * нет и кнопки (неотправленное, системное). У копии облачка в меню кнопка
 * только показывает число.
 *
 * `amMember` — я участник чата, где живёт сообщение (у облачка островка — чата
 * оригинала). Участнику на сообщении без комментариев кнопка тихая: главное —
 * сама переписка. Посетитель пришёл смотреть и обсуждать — ему всегда обычная.
 */
export function commentsEntry(
  message: ChatMessage,
  chatId: string,
  interactive: boolean,
  amMember: boolean,
): { count: number; quiet: boolean; onPress?: () => void } | undefined {
  if (!canCommentOn(message)) return undefined;

  return {
    count: message.commentsCount,
    quiet: amMember && message.commentsCount === 0,
    onPress: interactive ? () => openComments(message.id, chatId) : undefined,
  };
}
