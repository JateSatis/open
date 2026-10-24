// Черновики поля ввода по чатам: текст и то, что к нему приложено режимом, —
// ответ или правка. Клиентское состояние, поэтому в
// Zustand; переживает уход из чата и возвращение, как черновик в Telegram.
// Выбранные файлы сюда не входят: выбор живёт в `selectionStore` и
// сбрасывается с экраном.

import { create } from 'zustand';

import type { ChatRef, ForwardedComment, MessageAttachment } from '@/api/chats';
import type { Pop } from '@/api/pops';
import { shiftRanges, type HiddenRange } from '@/features/chats/hiddenText';
import { forwardPickerClosed, forwardPickerOpened } from '@/features/recs/journal/chatJournal';
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

/**
 * Режим поля ввода — плашка над ним. Режим один: новый заменяет прежний.
 * Пересылки здесь нет: её отправляет лист «Кому переслать».
 */
export type ComposerMode = { type: 'reply'; quotes: LiveQuote[] } | EditMode;

/**
 * Поп, прикреплённый к посту канала: уже опубликованный или новый — видео с
 * устройства, выбранное в редакторе попа. Новый публикуется вместе с постом.
 */
export type DraftPop =
  | { type: 'existing'; pop: Pop }
  | {
      type: 'new';
      /** Выбран заранее: повтор отправки не создаёт второй поп. */
      popId: string;
      /** Название попа — обязательно, его спрашивает редактор. */
      title: string;
      /** `file://` видео на устройстве. */
      uri: string;
      /** Кадр видео — обложка над полем и в посте до ответа сервера. */
      posterUri: string;
      mimeType: string;
      width: number;
      height: number;
      durationMs: number | null;
    };

export type ChatDraft = {
  text: string;
  /**
   * Куски текста, скрытые от зрителей, — code points. Едут за текстом при
   * каждой его смене (`shiftRanges`).
   */
  hidden?: HiddenRange[];
  mode: ComposerMode | null;
  /** Поп поста — только в чате постов канала. */
  pop?: DraftPop | null;
};

/**
 * Своя заметка из «Сохранённых», уходящая в чат обычным сообщением от меня:
 * текст и уже загруженные, очищенные файлы — без повторной загрузки.
 */
export type NoteForward = {
  savedId: string;
  kind: 'post' | 'voice';
  text: string | null;
  attachments: MessageAttachment[];
};

/**
 * Одна пачка пересылки: оригиналы одного чата по порядку на экране,
 * комментарии — или свои заметки, по сообщению на каждую.
 */
export type ForwardBatch =
  | { sourceChat: ChatRef; items: ForwardItem[] }
  | { comments: ForwardedComment[] }
  | { notes: NoteForward[] };

/**
 * Что пересылается, пока выбирают, куда: из чата — одна пачка (откуда и
 * какие оригиналы или комментарии из панели); из «Сохранённых» — несколько:
 * по островку на чат-источник и комментарии, в порядке на экране. `skipped`
 * — сколько из выбранного переслать нельзя (оригинал удалён).
 */
export type ForwardPick = ForwardBatch | { batches: ForwardBatch[]; skipped: number };

/** Пачки пересылки по порядку — у пересылки из чата она одна. */
export function forwardBatches(pick: ForwardPick): ForwardBatch[] {
  return 'batches' in pick ? pick.batches : [pick];
}

/** Сколько сообщений или комментариев в пачке. */
export function batchSize(batch: ForwardBatch): number {
  if ('comments' in batch) return batch.comments.length;
  if ('notes' in batch) return batch.notes.length;

  return batch.items.length;
}

type DraftsState = {
  byChat: Record<string, ChatDraft>;
  /** Выбрано «Переслать», лист «Кому переслать» открыт. */
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

    if (!next.text && !next.mode && !next.pop) delete byChat[chatId];
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
  update(chatId, (draft) =>
    draft.text === text
      ? draft
      : {
          ...draft,
          text,
          hidden: draft.hidden?.length ? shiftRanges(draft.text, text, draft.hidden) : draft.hidden,
        },
  );
}

/** Скрытое от зрителей в черновике — целиком, новым набором. */
export function setDraftHidden(chatId: string, hidden: HiddenRange[]) {
  update(chatId, (draft) => ({ ...draft, hidden }));
}

export function setDraftMode(chatId: string, mode: ComposerMode | null) {
  update(chatId, (draft) => (draft.mode === mode ? draft : { ...draft, mode }));
}

/** Прикрепляет поп к посту или открепляет его (`null`). */
export function setDraftPop(chatId: string, pop: DraftPop | null) {
  update(chatId, (draft) => (draft.pop === pop ? draft : { ...draft, pop }));
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
      // Своё сообщение участнику приходит оригиналом — диапазоны к нему и относятся.
      hidden: message.kind === 'voice' ? [] : (message.hiddenRanges ?? []),
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
    draft.mode?.type === 'edit'
      ? { ...draft, mode: { ...draft.mode, ...change(draft.mode) } }
      : draft,
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

/** Запоминает, что пересылать, пока человек выбирает, куда. */
export function startForwardPick(pick: ForwardPick) {
  const batches = forwardBatches(pick);
  const lead = batches[0];
  // Заметки — не сообщения и не комментарии: журналу рекомендаций в них
  // интересоваться нечем.
  const first =
    !lead || 'notes' in lead
      ? undefined
      : 'comments' in lead
        ? lead.comments[0]
        : lead.items[0]?.original;

  if (lead && first) {
    forwardPickerOpened(
      { type: 'comments' in lead ? 'comment' : 'message', id: first.id },
      batches.reduce((sum, batch) => sum + batchSize(batch), 0),
    );
  }

  useComposerDrafts.setState({ forwardPick: pick });
}

/** Что пересылается сейчас; нечего — `null`. */
export function readForwardPick(): ForwardPick | null {
  const pick = useComposerDrafts.getState().forwardPick;

  if (!pick || forwardBatches(pick).every((batch) => batchSize(batch) === 0)) return null;

  return pick;
}

/** Отправлено из листа: пересылать больше нечего. */
export function completeForwardPick() {
  forwardPickerClosed('picked');
  useComposerDrafts.setState({ forwardPick: null });
}

export function cancelForwardPick() {
  forwardPickerClosed('cancelled');
  useComposerDrafts.setState({ forwardPick: null });
}

/** Выход из аккаунта: чужие черновики следующему пользователю не нужны. */
export function resetComposerDrafts() {
  useComposerDrafts.setState({ byChat: {}, forwardPick: null });
}
