// Свои комментарии, которых сервер ещё не подтвердил: отправляются или упали.
// Клиентское состояние — в Zustand, как исходящие сообщения; в кеш
// комментарий попадает только с настоящим id. Живёт вне панели: закрыл её
// посреди отправки — комментарий всё равно доедет.

import { clientIdentity } from '@/api/perClient';
import { requestClient } from '@/api/requestClient';

import { createAccountStore } from '@/features/auth/accountStore';

import type { CommentItem } from '@/features/interactions/comments/commentItem';

type CommentOutboxState = {
  /** id цели (сообщения или попа) → свои неподтверждённые, самые новые первыми. */
  byTarget: Record<string, CommentItem[]>;
};

const EMPTY: CommentItem[] = [];

const useCommentOutbox = createAccountStore<CommentOutboxState>(() => ({ byTarget: {} }));

function setCommentThread(targetId: string, update: (items: CommentItem[]) => CommentItem[], api = requestClient()) {
  useCommentOutbox.forClient(api).setState((state) => {
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

export function outboxComments(targetId: string, api = requestClient()): CommentItem[] {
  return useCommentOutbox.forClient(api).getState().byTarget[targetId] ?? EMPTY;
}

export function addOutboxComments(targetId: string, drafts: CommentItem[], api = requestClient()) {
  setCommentThread(targetId, (current) => [...drafts.map(draft => ({ ...draft, deliveryOwner: clientIdentity(api) })), ...current], api);
}

export function setOutboxCommentStatus(
  targetId: string,
  localId: string,
  status: CommentItem['status'],
  api = requestClient(),
) {
  setCommentThread(targetId, (current) =>
    current.some((item) => item.localId === localId && item.status !== status)
      ? current.map((item) => (item.localId === localId ? { ...item, status } : item))
      : current,
    api,
  );
}

export function removeOutboxComment(targetId: string, localId: string, api = requestClient()) {
  setCommentThread(targetId, (current) =>
    current.some((item) => item.localId === localId)
      ? current.filter((item) => item.localId !== localId)
      : current,
    api,
  );
}

/** Выход из аккаунта: чужие исходящие следующему пользователю не нужны. */
export function resetCommentOutbox() {
  useCommentOutbox.setState({ byTarget: {} });
}
