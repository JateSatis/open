// Свои комментарии, которых сервер ещё не подтвердил: отправляются или упали.
// Клиентское состояние — в Zustand, как исходящие сообщения; в кеш
// комментарий попадает только с настоящим id. Живёт вне панели: закрыл её
// посреди отправки — комментарий всё равно доедет.

import { create } from 'zustand';

import type { CommentItem } from '@/features/interactions/comments/commentItem';

type CommentOutboxState = {
  /** messageId → свои неподтверждённые, самые новые первыми. */
  byMessage: Record<string, CommentItem[]>;
};

const EMPTY: CommentItem[] = [];

const useCommentOutbox = create<CommentOutboxState>(() => ({ byMessage: {} }));

function setThread(messageId: string, update: (items: CommentItem[]) => CommentItem[]) {
  useCommentOutbox.setState((state) => {
    const current = state.byMessage[messageId] ?? EMPTY;
    const next = update(current);

    if (next === current) return state;

    const byMessage = { ...state.byMessage };

    if (next.length === 0) delete byMessage[messageId];
    else byMessage[messageId] = next;

    return { byMessage };
  });
}

export function useOutboxComments(messageId: string): CommentItem[] {
  return useCommentOutbox((state) => state.byMessage[messageId] ?? EMPTY);
}

export function outboxComments(messageId: string): CommentItem[] {
  return useCommentOutbox.getState().byMessage[messageId] ?? EMPTY;
}

export function addOutboxComments(messageId: string, drafts: CommentItem[]) {
  setThread(messageId, (current) => [...drafts, ...current]);
}

export function setOutboxCommentStatus(
  messageId: string,
  localId: string,
  status: CommentItem['status'],
) {
  setThread(messageId, (current) =>
    current.some((item) => item.localId === localId && item.status !== status)
      ? current.map((item) => (item.localId === localId ? { ...item, status } : item))
      : current,
  );
}

export function removeOutboxComment(messageId: string, localId: string) {
  setThread(messageId, (current) =>
    current.some((item) => item.localId === localId)
      ? current.filter((item) => item.localId !== localId)
      : current,
  );
}

/** Выход из аккаунта: чужие исходящие следующему пользователю не нужны. */
export function resetCommentOutbox() {
  useCommentOutbox.setState({ byMessage: {} });
}
