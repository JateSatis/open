// Свои заметки «Сохранённых», которых сервер ещё не подтвердил, — стор без
// сети: его чистит выход из аккаунта, а отправка живёт в `notesOutbox.ts`.

import { requestClient } from '@/api/requestClient';
import { createAccountStore } from '@/features/auth/accountStore';

import type { LocalMedia, OutgoingMedia } from '@/features/media';
import type { SavedItem } from '@/features/saved/savedCopy';

/** Что уходит на сервер одной заметкой. */
export type NotePayload =
  | { type: 'post'; text: string; media: OutgoingMedia[]; replyTo: string[] }
  | { type: 'voice'; voice: LocalMedia; replyTo: string[] };

export type PendingNote = SavedItem & {
  deliveryOwner?: symbol;
  localId: string;
  /** Ключ повтора: сколько ни повторяй, заметка одна. */
  clientId: string;
  payload: NotePayload;
};

/** Кто пишет — подпись и аватар заметки до ответа сервера. */
export type NoteAuthor = { id: string; name: string | null; avatarUrl: string | null };

type NotesOutboxState = {
  /** Самые новые первыми, как и страницы. */
  items: PendingNote[];
};

export const useNotesOutbox = createAccountStore<NotesOutboxState>(() => ({ items: [] }));

export function usePendingNotes(): PendingNote[] {
  return useNotesOutbox((state) => state.items);
}

export function setItems(update: (items: PendingNote[]) => PendingNote[], api = requestClient()) {
  useNotesOutbox.forClient(api).setState((state) => {
    const items = update(state.items);

    return items === state.items ? state : { items };
  });
}

export function findPending(localId: string, api = requestClient()): PendingNote | undefined {
  return useNotesOutbox.forClient(api).getState().items.find((item) => item.localId === localId);
}

export function setStatus(localId: string, status: PendingNote['status'], api = requestClient()) {
  setItems((items) =>
    items.some((item) => item.localId === localId && item.status !== status)
      ? items.map((item) => (item.localId === localId ? { ...item, status } : item))
      : items,
    api,
  );
}

export function removePending(localId: string, api = requestClient()) {
  setItems((items) =>
    items.some((item) => item.localId === localId)
      ? items.filter((item) => item.localId !== localId)
      : items,
    api,
  );
}

/** Выход из аккаунта. */
export function resetNotesOutbox() {
  useNotesOutbox.setState({ items: [] });
}
