import { create } from 'zustand';

import { canCommentOn } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Какие комментарии открыты: к какому сообщению и, если известно, из какого чата. */
export type CommentsPanelTarget = {
  messageId: string;
  /** Чат, из переписки которого открыли, — его кеш сразу даёт облачко сверху. */
  chatId?: string;
  /**
   * Я участник чата сообщения — догадка ряда для мгновенного отклика моей
   * реакции на комментарий. Ряд всё равно решает база.
   */
  amMember?: boolean;
  /**
   * Комментарий, к которому пришли (тап по пересланному): он встаёт наверх,
   * его тред раскрыт, а сам он вспыхивает.
   */
  focusCommentId?: string;
};

type PanelState = {
  target: CommentsPanelTarget | null;
  /** Раскрытый тред — id корня. Раскрыт всегда не больше одного. */
  openThread: string | null;
};

const usePanelStore = create<PanelState>(() => ({ target: null, openThread: null }));

/**
 * Открывает панель комментариев к сообщению. Одна функция на всё
 * приложение: переписка открывает её по кружку у облачка, лента — у
 * фрагмента переписки, пересланный комментарий — у сниппета.
 */
export function openComments(
  messageId: string,
  chatId?: string,
  amMember = false,
  focusCommentId?: string,
) {
  usePanelStore.setState({ target: { messageId, chatId, amMember, focusCommentId }, openThread: null });
}

export function closeComments() {
  usePanelStore.setState({ target: null, openThread: null });
}

export function useCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore((state) => state.target);
}

export function useOpenThread(): string | null {
  return usePanelStore((state) => state.openThread);
}

export function getOpenThread(): string | null {
  return usePanelStore.getState().openThread;
}

/** Раскрывает тред этого корня; раскрытый до него закрывается. `null` — закрыть. */
export function setOpenThread(rootId: string | null) {
  usePanelStore.setState({ openThread: rootId });
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
    onPress: interactive ? () => openComments(message.id, chatId, amMember) : undefined,
  };
}
