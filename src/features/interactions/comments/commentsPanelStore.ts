import { create } from 'zustand';

import type { CommentSubject, FragmentSet } from '@/api/comments';
import type { FragmentRange } from '@/api/fragments';
import { canCommentOn } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';
import {
  commentsTargetChanged,
  commentThreadOpened,
} from '@/features/recs/journal/commentsJournal';

type FragmentPanelBase = {
  /** Ключ верха панели. */
  key: string;
  /**
   * Кусок в шапке и куда уходят мои реакция и комментарий из панели — мой
   * фрагмент на этом диапазоне (code points).
   */
  range: FragmentRange;
  /** Текст сообщения, по которому сняты диапазоны, — ключ кеша кластеров. */
  messageText: string;
  /** Открыли кнопкой комментария — сразу поле ввода с клавиатурой. */
  focusInput: boolean;
};

/**
 * Чья боковая панель открыта. Кластер — подсвеченный кусок: его сводные
 * реакции и комментарии всех его фрагментов; держится за id кластера, и
 * пересчёт его не подменяет. Область — выделенный кусок: фрагменты, больше
 * половины которых внутри; пустая область — просто цитата и поле ввода.
 */
export type FragmentPanelSubject =
  | (FragmentPanelBase & { kind: 'cluster'; clusterId: string; decisionId: string | null })
  | (FragmentPanelBase & { kind: 'area' });

/** Набор фрагментов, чьи комментарии показывает панель. */
export function fragmentSetOf(subject: FragmentPanelSubject): FragmentSet {
  return subject.kind === 'cluster'
    ? { kind: 'cluster', clusterId: subject.clusterId }
    : { kind: 'area', start: subject.range.start, end: subject.range.end };
}

/** Какие комментарии открыты: к какому сообщению или попу и, если известно, из какого чата. */
export type CommentsPanelTarget = {
  subject: CommentSubject;
  /** Кусок текста — боковая панель кластера или области, а не шит. */
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
   * Облачко переписки, где выделяли кусок текста (боковая панель): туда ведёт
   * цитата над комментарием. Ключ строки, а не id сообщения: в островке одно
   * сообщение бывает дважды.
   */
  rowKey?: string;
};

/** Окно треда: корень и как оно появилось — въехало справа или сразу на месте. */
export type OpenCommentThreadState = { rootId: string; instant: boolean };

type PanelState = {
  target: CommentsPanelTarget | null;
  /** Открытое окно треда. Открыто всегда не больше одного. */
  openCommentThread: OpenCommentThreadState | null;
};

const usePanelStore = create<PanelState>(() => ({ target: null, openCommentThread: null }));

// Сессия панели в журнале рекомендаций: открытие, смена цели, треды.
usePanelStore.subscribe((state, prev) => {
  if (state.target !== prev.target) commentsTargetChanged(state.target);
  if (state.openCommentThread !== prev.openCommentThread)
    commentThreadOpened(state.openCommentThread?.rootId ?? null);
});

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
    target: {
      subject: { type: 'message', id: messageId },
      chatId,
      amMember,
      focusCommentId,
    },
    openCommentThread: null,
  });
}

/**
 * Открывает боковую панель куска текста сообщения — кластера или области. `chatId` и `amMember`
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
    openCommentThread: null,
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
    openCommentThread: null,
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
  usePanelStore.setState({ target: null, openCommentThread: null });
}

export function useCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore((state) => state.target);
}

export function getCommentsPanelTarget(): CommentsPanelTarget | null {
  return usePanelStore.getState().target;
}

export function useOpenCommentThread(): OpenCommentThreadState | null {
  return usePanelStore((state) => state.openCommentThread);
}

export function getOpenCommentThread(): string | null {
  return usePanelStore.getState().openCommentThread?.rootId ?? null;
}

/**
 * Открывает окно треда этого корня; `null` — закрыть. `instant` — без въезда:
 * шит открылся сразу в треде (пришли к пересланному ответу).
 */
export function setOpenCommentThread(rootId: string | null, instant = false) {
  usePanelStore.setState({ openCommentThread: rootId ? { rootId, instant } : null });
}

/**
 * Круг комментариев сбоку от облачка переписки: число и открытие панели.
 * У неотправленного и системного круга нет. У копии облачка круг только
 * показывает число.
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
): { count: number; onPress?: () => void } | undefined {
  if (!canCommentOn(message)) return undefined;
  if (amMember && message.commentsCount === 0) return undefined;

  return {
    count: message.commentsCount,
    onPress: interactive ? () => openComments(message.id, chatId, amMember) : undefined,
  };
}
