// Черновики поля ввода по чатам: текст и то, что к нему приложено режимом, —
// ответ, пересылка или правка. Клиентское состояние, поэтому в
// Zustand; переживает уход из чата и возвращение, как черновик в Telegram.
// Выбранные файлы сюда не входят: выбор живёт в `selectionStore` и
// сбрасывается с экраном.

import { create } from 'zustand';

import type { ChatRef, ForwardedComment, MessageAttachment } from '@/api/chats';
import type {
  ChatMessage,
  EditVoice,
  ForwardItem,
  LiveQuote,
} from '@/features/chats/messages/types';

/**
 * Правка своего сообщения. Текст правки живёт в `text` черновика, как любой
 * другой; здесь — что осталось от вложений и черновик, который был до входа в
 * правку: после выхода он возвращается как был.
 */
export type EditMode = {
  type: 'edit';
  message: ChatMessage;
  /** Оставленные фото и видео — по порядку. */
  kept: MessageAttachment[];
  voice: EditVoice | null;
  restore: ChatDraft;
};

/** Режим поля ввода — плашка над ним. Режим один: новый заменяет прежний. */
export type ComposerMode =
  | { type: 'reply'; quotes: LiveQuote[] }
  | { type: 'forward'; sourceChat: ChatRef; items: ForwardItem[] }
  /** Пересылка комментариев — по сообщению на комментарий, в порядке панели. */
  | { type: 'forward_comments'; comments: ForwardedComment[] }
  | EditMode;

export type ChatDraft = {
  text: string;
  mode: ComposerMode | null;
};

/**
 * Что пересылается, пока выбирают, куда: откуда и какие оригиналы, по
 * порядку на экране, — или комментарии из панели.
 */
export type ForwardPick =
  | { sourceChat: ChatRef; items: ForwardItem[] }
  | { comments: ForwardedComment[] };

type DraftsState = {
  byChat: Record<string, ChatDraft>;
  /** Выбрано «Переслать», но чат, куда, ещё не выбран. */
  forwardPick: ForwardPick | null;
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

/**
 * Вход в правку: в поле — текст сообщения, под плашкой — его вложения. Прежний
 * черновик откладывается; если уже шла правка другого сообщения, откладывать
 * нужно тот, что был до неё.
 */
export function startEditDraft(chatId: string, message: ChatMessage) {
  update(chatId, (draft) => {
    const restore = draft.mode?.type === 'edit' ? draft.mode.restore : draft;
    const voice = message.kind === 'voice' ? message.attachments[0] : undefined;

    return {
      text: message.kind === 'voice' ? '' : (message.text ?? ''),
      mode: {
        type: 'edit',
        message,
        kept: message.kind === 'media' ? message.attachments : [],
        voice: voice
          ? { type: 'kept', attachment: voice, localUri: message.localPreviews?.[0] }
          : null,
        restore,
      },
    };
  });
}

/** Меняет вложения идущей правки. Вне правки — ничего. */
export function updateEditDraft(
  chatId: string,
  change: (mode: EditMode) => Pick<EditMode, 'kept' | 'voice'>,
) {
  update(chatId, (draft) =>
    draft.mode?.type === 'edit' ? { ...draft, mode: { ...draft.mode, ...change(draft.mode) } } : draft,
  );
}

/** Выход из правки — сохранённой или нет: возвращается черновик, который был до неё. */
export function finishEditDraft(chatId: string) {
  update(chatId, (draft) => (draft.mode?.type === 'edit' ? draft.mode.restore : draft));
}

/** Отправлено: поле пустое, плашки нет. */
export function clearDraft(chatId: string) {
  update(chatId, () => EMPTY);
}

/** Запоминает, что пересылать, пока человек выбирает чат. */
export function startForwardPick(pick: ForwardPick) {
  useComposerDrafts.setState({ forwardPick: pick });
}

/** Чат выбран: пересылка становится черновиком этого чата. */
export function finishForwardPick(chatId: string): boolean {
  const pick = useComposerDrafts.getState().forwardPick;

  if (!pick || ('comments' in pick ? pick.comments : pick.items).length === 0) return false;

  useComposerDrafts.setState({ forwardPick: null });
  // Пересылка в чат, где шла правка, правку прерывает: плашка одна.
  finishEditDraft(chatId);
  setDraftMode(
    chatId,
    'comments' in pick
      ? { type: 'forward_comments', comments: pick.comments }
      : { type: 'forward', sourceChat: pick.sourceChat, items: pick.items },
  );

  return true;
}

export function cancelForwardPick() {
  useComposerDrafts.setState({ forwardPick: null });
}

/** Выход из аккаунта: чужие черновики следующему пользователю не нужны. */
export function resetComposerDrafts() {
  useComposerDrafts.setState({ byChat: {}, forwardPick: null });
}
