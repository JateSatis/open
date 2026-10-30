// Свои комментарии, которых сервер ещё не подтвердил: отправляются или упали.
// Клиентское состояние — в Zustand, как исходящие сообщения; в кеш
// комментарий попадает только с настоящим id. Живёт вне панели: закрыл её
// посреди отправки — комментарий всё равно доедет.

import { create } from 'zustand';

import type { CommentItem } from '@/features/interactions/comments/commentItem';

type CommentOutboxState = {
  /** id цели (сообщения или попа) → свои неподтверждённые, самые новые первыми. */
  byTarget: Record<string, CommentItem[]>;
};

const EMPTY: CommentItem[] = [];

const useCommentOutbox = create<CommentOutboxState>(() => ({ byTarget: {} }));

function setCommentThread(targetId: string, update: (items: CommentItem[]) => CommentItem[]) {
  useCommentOutbox.setState((state) => {
    const current = state.byTarget[targetId] ?? EMPTY;
    const next = update(current);

    if (next === current) return state;

    const byTarget = { ...state.byTarget };

    if (next.length === 0) delete byTarget[targetId];
    else byTarget[targetId] = next;

    return { byTarget };
  });
}

export function useOutboxComments(targetId: string): CommentItem[] {
  return useCommentOutbox((state) => state.byTarget[targetId] ?? EMPTY);
}

export function outboxComments(targetId: string): CommentItem[] {
  return useCommentOutbox.getState().byTarget[targetId] ?? EMPTY;
}

export function addOutboxComments(targetId: string, drafts: CommentItem[]) {
  setCommentThread(targetId, (current) => [...drafts, ...current]);
}

export function setOutboxCommentStatus(
  targetId: string,
  localId: string,
  status: CommentItem['status'],
) {
  setCommentThread(targetId, (current) =>
    current.some((item) => item.localId === localId && item.status !== status)
      ? current.map((item) => (item.localId === localId ? { ...item, status } : item))
      : current,
  );
}

export function removeOutboxComment(targetId: string, localId: string) {
  setCommentThread(targetId, (current) =>
    current.some((item) => item.localId === localId)
      ? current.filter((item) => item.localId !== localId)
      : current,
  );
}

/** Выход из аккаунта: чужие исходящие следующему пользователю не нужны. */
export function resetCommentOutbox() {
  useCommentOutbox.setState({ byTarget: {} });
}
