import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import type { TextInput } from 'react-native';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage } from '@/api/saved';
import { setDraftMode } from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import type { LocalMedia } from '@/features/media';
import { useMyProfile } from '@/features/profile/queries';
import { retryNote, sendNotePost, sendNoteVoice } from '@/features/saved/notesOutbox';
import { findSaved } from '@/features/saved/savedCache';
import { savedReplyQuote, toBubbleMessage } from '@/features/saved/savedCopy';
import { useSavedActions } from '@/features/saved/useSavedActions';
import { focusWithKeyboard } from '@/lib/windowFocus';

/** Черновик поля заметок — в общем сторе черновиков, под своим ключом. */
export const SAVED_DRAFT_KEY = 'saved';

/**
 * Поле заметок «Сохранённых»: черновик, ответ на записи, правка своей
 * заметки и отправка. Живёт на экране, а не во вкладке: «Ответить» и
 * «Изменить» с «Посмотреть позже» переключают на «Все» и попадают сюда же.
 */
export function useSavedComposer(currentUserId: string | null) {
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput | null>(null);
  const draft = useComposerDraft(SAVED_DRAFT_KEY);
  const { data: me } = useMyProfile();
  const { editNote } = useSavedActions();

  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => {
      const saved = findSaved(queryClient, original.id);

      if (saved) {
        editNote(
          saved,
          result.text,
          result.kept.map((attachment) => attachment.id),
        );
      }
    },
    [editNote, queryClient],
  );
  const edit = useMessageEdit({
    chatId: SAVED_DRAFT_KEY,
    draft,
    composerRef: inputRef,
    saveEdit,
  });
  // Правка заметки только убирает: новых файлов и записи вместо прежних нет.
  const editState = useMemo(
    () =>
      edit.composer ? { ...edit.composer, attachDisabled: true, recordDisabled: true } : undefined,
    [edit.composer],
  );

  const author = useMemo(
    () =>
      currentUserId
        ? { id: currentUserId, name: me?.displayName ?? null, avatarUrl: me?.avatarUrl ?? null }
        : null,
    [currentUserId, me?.avatarUrl, me?.displayName],
  );
  const { mode, setMode } = draft;
  const quotes = useMemo(() => (mode?.type === 'reply' ? mode.quotes : []), [mode]);
  const isEditing = edit.mode !== null;

  const send = useCallback(() => {
    if (!author) return;

    sendNotePost(queryClient, author, draft.text, draft.media(), quotes);
    draft.clear();
  }, [author, draft, queryClient, quotes]);

  const sendVoice = useCallback(
    (voice: LocalMedia) => {
      if (!author) return;

      sendNoteVoice(queryClient, author, voice, quotes);
      // Голосовое тоже ответ; написанный текст остаётся в поле.
      if (quotes.length > 0) setMode(null);
    },
    [author, queryClient, quotes, setMode],
  );

  const startReply = useCallback(
    (items: SavedMessage[], chats: ReadonlyMap<string, ChatSummary>) => {
      // Цитаты — по порядку на экране: сверху старые.
      const ordered = [...items].sort((a, b) => a.seq - b.seq);

      if (ordered.length === 0) return;

      setDraftMode(SAVED_DRAFT_KEY, {
        type: 'reply',
        quotes: ordered.map((saved) => savedReplyQuote(saved, chats, currentUserId)),
      });
      claimKeyboardForChat();
      // Меню и выбор закрываются в этом же кадре — поле успевает стать
      // видимым, прежде чем получить фокус.
      focusWithKeyboard(inputRef);
    },
    [currentUserId],
  );

  const { start: startEditing, leave: leaveEdit } = edit;
  const startEdit = useCallback(
    (saved: SavedMessage) => startEditing(toBubbleMessage(saved)),
    [startEditing],
  );

  const closeMode = useCallback(() => {
    if (isEditing) void leaveEdit();
    else setMode(null);
  }, [isEditing, leaveEdit, setMode]);

  const retry = useCallback(
    (localId: string) => {
      if (currentUserId) retryNote(queryClient, currentUserId, localId);
    },
    [currentUserId, queryClient],
  );

  return {
    inputRef,
    draft,
    edit,
    editState,
    isEditing,
    submit: isEditing ? edit.save : send,
    sendVoice,
    startReply,
    startEdit,
    closeMode,
    retry,
  };
}

export type SavedComposerState = ReturnType<typeof useSavedComposer>;
