import { useCallback, useEffect, useMemo, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';

import { confirm } from '@/components/ConfirmDialog';
import {
  finishEditDraft,
  readChatDraft,
  startEditDraft,
  updateEditDraft,
  type EditMode,
} from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import {
  canRecordInEdit,
  editMediaRoom,
  isEditEmpty,
  isEditUnchanged,
} from '@/features/chats/editRules';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { selectedAssets, setSelectionLimit, type LocalMedia } from '@/features/media';
import { focusWithKeyboard } from '@/lib/windowFocus';

type Options = {
  chatId: string;
  draft: ComposerDraft;
  composerRef: RefObject<TextInput | null>;
  saveEdit: (original: ChatMessage, result: EditResult) => void;
};

/** Что доступно в поле ввода, пока идёт правка. */
export type EditComposerState = {
  canSave: boolean;
  textLocked: boolean;
  attachDisabled: boolean;
  recordDisabled: boolean;
};

export type MessageEdit = {
  /** Идущая правка; `null` — поле в обычном режиме. */
  mode: EditMode | null;
  /** «Изменить»: поле переходит в правку этого сообщения. */
  start: (message: ChatMessage) => void;
  /**
   * Выйти из правки без сохранения. Если что-то изменено — сначала вопрос.
   * Отвечает, вышли ли: человек мог передумать. Вне правки — сразу `true`.
   */
  leave: () => Promise<boolean>;
  /** «О» в правке: сохранить, а если ничего не изменилось — просто выйти. */
  save: () => void;
  /** Запись «Г» в правке не отправляется, а встаёт в чип. */
  recorded: (voice: LocalMedia) => void;
  removeAttachment: (attachmentId: string) => void;
  removeVoice: () => void;
  composer: EditComposerState | undefined;
};

function resultOf(text: string, mode: EditMode, withSelection: boolean): EditResult {
  return {
    text: mode.voice ? '' : text,
    kept: mode.kept,
    added: withSelection ? selectedAssets() : [],
    voice: mode.voice,
  };
}

/**
 * Правка своего сообщения поверх черновика поля ввода. Прежний черновик
 * (текст, ответ, пересылка) откладывается на время правки и возвращается,
 * как только правка закончена — сохранением или отменой.
 */
export function useMessageEdit({ chatId, draft, composerRef, saveEdit }: Options): MessageEdit {
  const mode = draft.mode?.type === 'edit' ? draft.mode : null;
  const { text, clearMedia } = draft;

  // Шит медиа в правке добавляет к тому, что в сообщении уже есть: выбрать
  // можно столько, сколько ещё влезает в альбом.
  const room = mode ? editMediaRoom(mode) : null;

  // Вне правки предел не трогается: поле ввода не одно (чат и панель
  // комментариев), и простаивающее не должно сбивать предел идущей правки.
  useEffect(() => {
    if (room === null) return;

    setSelectionLimit(room);

    return () => setSelectionLimit(null);
  }, [room]);

  // Ушёл с экрана — правка не ждёт его в черновике: вернувшись, человек
  // увидит свой прежний черновик, а не полусобранное сообщение.
  useEffect(() => () => finishEditDraft(chatId), [chatId]);

  const start = useCallback(
    (message: ChatMessage) => {
      startEditDraft(chatId, message);
      clearMedia();

      if (message.kind === 'voice') {
        Keyboard.dismiss();
        return;
      }

      claimKeyboardForChat();
      // Меню закрывается в этом же кадре — поле успевает стать видимым,
      // прежде чем получить фокус. Курсор — в конец текста.
      focusWithKeyboard(composerRef, (input) => {
        const end = readChatDraft(chatId).text.length;

        // Не у каждой реализации поля есть `setSelection` — в тестовом окружении его нет.
        input.setSelection?.(end, end);
      });
    },
    [chatId, clearMedia, composerRef],
  );

  const leave = useCallback(async () => {
    const current = readChatDraft(chatId);

    if (current.mode?.type !== 'edit') return true;

    const result = resultOf(current.text, current.mode, true);

    if (!isEditUnchanged(current.mode.message, result)) {
      const confirmed = await confirm({
        title: 'Отменить изменения?',
        message: 'Сообщение останется таким, каким было.',
        confirmLabel: 'Отменить',
        cancelLabel: 'Продолжить',
        destructive: true,
      });

      if (!confirmed) return false;
    }

    finishEditDraft(chatId);
    clearMedia();

    return true;
  }, [chatId, clearMedia]);

  const save = useCallback(() => {
    const current = readChatDraft(chatId);

    if (current.mode?.type !== 'edit') return;

    const result = resultOf(current.text, current.mode, true);

    if (isEditEmpty(result)) return;

    if (!isEditUnchanged(current.mode.message, result)) saveEdit(current.mode.message, result);

    finishEditDraft(chatId);
    clearMedia();
  }, [chatId, clearMedia, saveEdit]);

  const recorded = useCallback(
    (voice: LocalMedia) => updateEditDraft(chatId, () => ({ kept: [], voice: { type: 'new', voice } })),
    [chatId],
  );

  const removeAttachment = useCallback(
    (attachmentId: string) =>
      updateEditDraft(chatId, (current) => ({
        kept: current.kept.filter((attachment) => attachment.id !== attachmentId),
        voice: current.voice,
      })),
    [chatId],
  );

  const removeVoice = useCallback(
    () => updateEditDraft(chatId, (current) => ({ kept: current.kept, voice: null })),
    [chatId],
  );

  const composer = useMemo(() => {
    if (!mode) return undefined;

    const result = resultOf(text, mode, false);

    return {
      canSave: !isEditEmpty(result),
      textLocked: mode.voice !== null,
      attachDisabled: editMediaRoom(mode) === 0,
      recordDisabled: !canRecordInEdit(result),
    };
  }, [mode, text]);

  return { mode, start, leave, save, recorded, removeAttachment, removeVoice, composer };
}
