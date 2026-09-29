// Черновики поля ввода по чатам: текст и то, что к нему приложено режимом, —
// ответ или пересылка (а дальше и правка). Клиентское состояние, поэтому в
// Zustand; переживает уход из чата и возвращение, как черновик в Telegram.
// Выбранные файлы сюда не входят: выбор живёт в `selectionStore` и
// сбрасывается с экраном.

import { create } from 'zustand';

import type { ForwardItem, LiveQuote } from '@/features/chats/messages/types';

/** Режим поля ввода — плашка над ним. Режим один: новый заменяет прежний. */
export type ComposerMode =
  | { type: 'reply'; quotes: LiveQuote[] }
  | { type: 'forward'; items: ForwardItem[] };

export type ChatDraft = {
  text: string;
  mode: ComposerMode | null;
};

type DraftsState = {
  byChat: Record<string, ChatDraft>;
  /** Выбрано «Переслать», но чат, куда, ещё не выбран. */
  forwardPick: ForwardItem[] | null;
};

const EMPTY: ChatDraft = { text: '', mode: null };

export const useComposerDrafts = create<DraftsState>(() => ({ byChat: {}, forwardPick: null }));

function update(chatId: string, change: (draft: ChatDraft) => ChatDraft) {
  useComposerDrafts.setState((state) => {
    const current = state.byChat[chatId] ?? EMPTY;
    const next = change(current);

    if (next === current) return state;

    const byChat = { ...state.byChat };

    if (!next.text && !next.mode) delete byChat[chatId];
    else byChat[chatId] = next;

    return { byChat };
  });
}

export function useChatDraft(chatId: string): ChatDraft {
  return useComposerDrafts((state) => state.byChat[chatId] ?? EMPTY);
}

export function readChatDraft(chatId: string): ChatDraft {
  return useComposerDrafts.getState().byChat[chatId] ?? EMPTY;
}

export function setDraftText(chatId: string, text: string) {
  update(chatId, (draft) => (draft.text === text ? draft : { ...draft, text }));
}

export function setDraftMode(chatId: string, mode: ComposerMode | null) {
  update(chatId, (draft) => (draft.mode === mode ? draft : { ...draft, mode }));
}

/** Отправлено: поле пустое, плашки нет. */
export function clearDraft(chatId: string) {
  update(chatId, () => EMPTY);
}

/** Запоминает, что пересылать, пока человек выбирает чат. */
export function startForwardPick(items: ForwardItem[]) {
  useComposerDrafts.setState({ forwardPick: items });
}

/** Чат выбран: пересылка становится черновиком этого чата. */
export function finishForwardPick(chatId: string): boolean {
  const items = useComposerDrafts.getState().forwardPick;

  if (!items || items.length === 0) return false;

  useComposerDrafts.setState({ forwardPick: null });
  setDraftMode(chatId, { type: 'forward', items });

  return true;
}

export function cancelForwardPick() {
  useComposerDrafts.setState({ forwardPick: null });
}

/** Выход из аккаунта: чужие черновики следующему пользователю не нужны. */
export function resetComposerDrafts() {
  useComposerDrafts.setState({ byChat: {}, forwardPick: null });
}
