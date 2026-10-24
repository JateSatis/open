import { useIsFocused } from 'expo-router';

import { modePlate } from '@/features/chats/ChatFooter';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import {
  armMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { SavedComposerState } from '@/features/saved/useSavedComposer';

const PLACEHOLDER = 'Заметка';
const TITLE = 'Сохранённые';

const noop = () => undefined;
const armSheet = () => armMediaSheet('saved');
const openSheet = () => openMediaSheet('saved');

export type SavedComposerProps = {
  composer: SavedComposerState;
};

/**
 * Поле заметок внизу «Все» — то же, что под перепиской: текст, медиа через
 * скрепку (свой экземпляр шита — выбранное уходит в заметку), голосовое,
 * эмодзи, плашка ответа или правки. Заметку видит только владелец, поэтому
 * ни «Скрыть от зрителей», ни подсказки о личных данных, ни «печатает».
 */
export function SavedComposer({ composer }: SavedComposerProps) {
  const focused = useIsFocused();
  const { draft, edit, editState, isEditing } = composer;
  const editPlate = editState
    ? {
        onRemoveAttachment: edit.removeAttachment,
        onRemoveVoice: edit.removeVoice,
        state: editState,
      }
    : undefined;
  const plate = modePlate(draft.mode, composer.closeMode, editPlate);

  return (
    <>
      <MessageComposer
        text={draft.text}
        onChangeText={draft.setText}
        canSend
        isPrivate
        placeholder={PLACEHOLDER}
        plate={plate}
        edit={editPlate?.state}
        inputRef={composer.inputRef}
        screenFocused={focused}
        onSend={composer.submit}
        onTyping={noop}
        onFieldActivate={claimKeyboardForChat}
        onAttachPressIn={armSheet}
        onAttachPressOut={releaseMediaSheetArm}
        onAttachPress={openSheet}
        onSendVoice={isEditing ? edit.recorded : composer.sendVoice}
      />

      {/* Окно шита — только у экрана на виду: под ним может жить чат со своим шитом. */}
      {focused ? (
        <MediaPickerSheet
          owner="saved"
          draft={draft}
          plate={draft.mode ? plate : null}
          editing={isEditing}
          isPrivate
          placeholder={PLACEHOLDER}
          title={TITLE}
          onTyping={noop}
          onSend={composer.submit}
        />
      ) : null}
    </>
  );
}
