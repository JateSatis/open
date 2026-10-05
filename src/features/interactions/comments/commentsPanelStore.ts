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
  /**
   * Верх шита в среднем положении, в координатах окна. Известен, когда шапка
   * шита замерена; по нему переписка под шитом ставит сообщение над ним.
   */
  restTop: number | null;
};

const usePanelStore = create<PanelState>(() => ({ target: null, openThread: null, restTop: null }));

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
  usePanelStore.setState({
    target: { messageId, chatId, amMember, focusCommentId },
    openThread: null,
    restTop: null,
  });
}

export function closeComments() {
  usePanelStore.setState({ target: null, openThread: null, restTop: null });
}

export function useCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore((state) => state.target);
}

export function getCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore.getState().target;
}

/** Шит замерен и встал в положения — или ушёл (`null`). */
export function setPanelRestTop(restTop: number | null) {
  usePanelStore.setState({ restTop });
}

/** Верх шита в среднем положении, как только он известен; `null` — не дождались. */
export function waitPanelRestTop(timeoutMs: number): Promise<number | null> {
  const known = usePanelStore.getState().restTop;

  if (known !== null) return Promise.resolve(known);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = usePanelStore.subscribe((state) => {
      if (state.restTop === null) return;

      clearTimeout(timer);
      unsubscribe();
      resolve(state.restTop);
    });
  });
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
