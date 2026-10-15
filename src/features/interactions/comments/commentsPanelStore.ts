import { create } from 'zustand';

import type { CommentSubject } from '@/api/comments';
import type { FragmentRange } from '@/api/fragments';
import { canCommentOn } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';

/**
 * Фрагмент текста, чья боковая панель открыта: цитата, реакции и только его
 * комментарии. Этап 3 добавит сюда кластер — несколько фрагментов одного
 * куска текста — отдельным видом цели.
 */
export type FragmentPanelSubject = {
  kind: 'fragment';
  /** Ключ верха панели: мой фрагмент на этом диапазоне. */
  key: string;
  /** Фрагмент в базе; у своего нового — `null`, пока не уйдёт первая реакция или комментарий. */
  fragmentId: string | null;
  /** Диапазон для базы (code points) и сам кусок — цитата в шапке. */
  range: FragmentRange;
  /** Открыли кнопкой комментария — сразу поле ввода с клавиатурой. */
  focusInput: boolean;
};

/** Какие комментарии открыты: к какому сообщению или попу и, если известно, из какого чата. */
export type CommentsPanelTarget = {
  subject: CommentSubject;
  /** Только комментарии фрагмента — боковая панель, а не шит. */
  fragment?: FragmentPanelSubject;
  /** Чат, из переписки которого открыли, — его кеш сразу даёт облачко сверху. */
  chatId?: string;
  /**
   * Я участник чата сообщения — догадка ряда для мгновенного отклика моей
   * реакции на комментарий. Ряд всё равно решает база.
   */
  amMember?: boolean;
  /**
   * Комментарий, к которому пришли (тап по пересланному): он встаёт наверх,
   * а ответ открывает окно своего треда; сам он вспыхивает.
   */
  focusCommentId?: string;
  /**
   * Строка переписки, у которой открыли: её сообщение поднимается над шитом.
   * Ключ строки, а не id сообщения: в островке одно сообщение бывает дважды.
   */
  rowKey?: string;
  /** Строка ещё едет (прокрутка к ней) — поднимать, когда встанет. */
  settle?: boolean;
};

/** Откуда поднимать сообщение над шитом — см. `CommentsPanelTarget`. */
export type CommentsLiftFrom = { rowKey: string; settle?: boolean };

/** Окно треда: корень и как оно появилось — въехало справа или сразу на месте. */
export type OpenThreadState = { rootId: string; instant: boolean };

type PanelState = {
  target: CommentsPanelTarget | null;
  /** Открытое окно треда. Открыто всегда не больше одного. */
  openThread: OpenThreadState | null;
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
  from?: CommentsLiftFrom,
) {
  usePanelStore.setState({
    target: {
      subject: { type: 'message', id: messageId },
      chatId,
      amMember,
      focusCommentId,
      ...from,
    },
    openThread: null,
  });
}

/**
 * Открывает боковую панель фрагмента текста сообщения. `chatId` и `amMember`
 * — чата, где живёт сообщение (у облачка островка — чата оригинала).
 * `rowKey` — облачко, где выделяли: туда ведёт цитата над комментарием.
 * Сообщение над боковой панелью не поднимается.
 */
export function openFragmentComments(
  messageId: string,
  chatId: string,
  amMember: boolean,
  fragment: FragmentPanelSubject,
  rowKey?: string,
) {
  usePanelStore.setState({
    target: { subject: { type: 'message', id: messageId }, chatId, amMember, fragment, rowKey },
    openThread: null,
  });
}

/**
 * Открывает панель комментариев к попу — из просмотра попсов. `amMember` —
 * я публикую в канале: догадка ряда для отклика моей реакции и показ
 * закрепа, решает база. `focusCommentId` — пришли по пересланному комментарию.
 */
export function openPopComments(popId: string, amMember = false, focusCommentId?: string) {
  usePanelStore.setState({
    target: { subject: { type: 'pop', id: popId }, amMember, focusCommentId },
    openThread: null,
  });
}

/**
 * Право публиковать в канале пришло позже, чем открыли комментарии к попу, —
 * поправить догадку ряда и пункты закрепа у открытой панели.
 */
export function setCommentsAmMember(amMember: boolean) {
  const { target } = usePanelStore.getState();

  if (target && target.amMember !== amMember) {
    usePanelStore.setState({ target: { ...target, amMember } });
  }
}

export function closeComments() {
  usePanelStore.setState({ target: null, openThread: null });
}

export function useCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore((state) => state.target);
}

export function getCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore.getState().target;
}

export function useOpenThread(): OpenThreadState | null {
  return usePanelStore((state) => state.openThread);
}

export function getOpenThread(): string | null {
  return usePanelStore.getState().openThread?.rootId ?? null;
}

/**
 * Открывает окно треда этого корня; `null` — закрыть. `instant` — без въезда:
 * шит открылся сразу в треде (пришли к пересланному ответу).
 */
export function setOpenThread(rootId: string | null, instant = false) {
  usePanelStore.setState({ openThread: rootId ? { rootId, instant } : null });
}

/**
 * Круг комментариев сбоку от облачка переписки: число и открытие панели.
 * `rowKey` — строка облачка: её сообщение поднимется над шитом. Нет — нет и
 * круга (неотправленное, системное). У копии облачка круг только показывает
 * число.
 *
 * `amMember` — я участник чата, где живёт сообщение (у облачка островка — чата
 * оригинала). Участнику круга нет, пока нет комментариев: главное — сама
 * переписка, а первый он пишет из меню сообщения. Посетитель пришёл смотреть
 * и обсуждать — ему круг всегда.
 */
export function commentsEntry(
  message: ChatMessage,
  chatId: string,
  interactive: boolean,
  amMember: boolean,
  rowKey?: string,
): { count: number; onPress?: () => void } | undefined {
  if (!canCommentOn(message)) return undefined;
  if (amMember && message.commentsCount === 0) return undefined;

  return {
    count: message.commentsCount,
    onPress: interactive
      ? () => openComments(message.id, chatId, amMember, undefined, rowKey ? { rowKey } : undefined)
      : undefined,
  };
}
