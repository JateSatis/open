import type { RefObject } from 'react';
import { View, type TextInput } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { modePlate } from '@/features/chats/ChatFooter';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import {
  armMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { MessageEdit } from '@/features/chats/useMessageEdit';
import type { LocalMedia } from '@/features/media';
import {
  commentsComposerFocused,
  commentsComposerSent,
  commentsComposerTyping,
  commentsVoiceActivity,
  commentsVoiceSent,
} from '@/features/recs/journal/commentsJournal';
import { useTheme } from '@/hooks/use-theme';

export type CommentComposerProps = {
  draft: ComposerDraft;
  edit: MessageEdit;
  inputRef: RefObject<TextInput | null>;
  /** Сообщение или поп удалены — новые комментарии не принимаются; текст плашки. */
  closedNotice: string | null;
  /** Подпись пустого поля. */
  placeholder: string;
  /** Шапка предпросмотра файлов — чат сообщения или канал попа. */
  title: string;
  onSend: () => void;
  onSendVoice: (voice: LocalMedia) => void;
};

const typing = () => commentsComposerTyping();
const recording = () => commentsVoiceActivity();
const activateField = () => {
  commentsComposerFocused();
  claimKeyboardForComments();
};
const armSheet = () => armMediaSheet('comments');
const openSheet = () => openMediaSheet('comments');

/**
 * Поле ввода панели — то же, что под перепиской: текст, медиа через «M»,
 * голосовое через «Г» с отменой и замком, режим правки с плашкой. Видно
 * всем, и посетителю тоже: комментировать может любой. Шит медиа — свой
 * экземпляр с хозяином «комментарии»: выбранное уходит в комментарий, а не
 * в чат.
 */
export function CommentComposer({
  draft,
  edit,
  inputRef,
  closedNotice,
  placeholder,
  title,
  onSend,
  onSendVoice,
}: CommentComposerProps) {
  const theme = useTheme();

  if (closedNotice) {
    return (
      <View style={[styles.closedNotice, { borderTopColor: theme.border }]}>
        <Text variant="small" color="textSecondary">
          {closedNotice}
        </Text>
      </View>
    );
  }

  const isEditing = edit.mode !== null;
  const editPlate = edit.composer
    ? {
        onRemoveAttachment: edit.removeAttachment,
        onRemoveVoice: edit.removeVoice,
        state: edit.composer,
      }
    : undefined;
  // Крестик плашки: правка выходит из правки, ответ просто снимается.
  const closeMode = () => (isEditing ? void edit.leave() : draft.setMode(null));
  const plate = modePlate(draft.mode, closeMode, editPlate);
  // Журнал: отправлено и сколько символов; правка — не новый комментарий.
  const send = () => {
    if (!isEditing) commentsComposerSent([...draft.text.trim()].length);
    onSend();
  };
  const sendVoice = (voice: LocalMedia) => {
    commentsVoiceSent();
    onSendVoice(voice);
  };

  return (
    <>
      <MessageComposer
        text={draft.text}
        onChangeText={draft.setText}
        canSend
        placeholder={placeholder}
        plate={plate}
        edit={editPlate?.state}
        inputRef={inputRef}
        onSend={send}
        onTyping={typing}
        onFieldActivate={activateField}
        onAttachPressIn={armSheet}
        onAttachPressOut={releaseMediaSheetArm}
        onAttachPress={openSheet}
        onSendVoice={isEditing ? edit.recorded : sendVoice}
        onRecordingVoice={isEditing ? undefined : recording}
      />

      <MediaPickerSheet
        owner="comments"
        draft={draft}
        plate={isEditing ? plate : null}
        editing={isEditing}
        placeholder={placeholder}
        title={title}
        onTyping={typing}
        onSend={send}
      />
    </>
  );
}
