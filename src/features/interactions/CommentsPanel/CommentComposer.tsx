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
import { useTheme } from '@/hooks/use-theme';

export type CommentComposerProps = {
  draft: ComposerDraft;
  edit: MessageEdit;
  inputRef: RefObject<TextInput | null>;
  /** Сообщение удалено — новые комментарии не принимаются. */
  closed: boolean;
  onSend: () => void;
  onSendVoice: (voice: LocalMedia) => void;
};

const noop = () => undefined;
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
  closed,
  onSend,
  onSendVoice,
}: CommentComposerProps) {
  const theme = useTheme();

  if (closed) {
    return (
      <View style={[styles.closedNotice, { borderTopColor: theme.border }]}>
        <Text variant="small" color="textSecondary">
          Сообщение удалено — новые комментарии не принимаются.
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

  return (
    <>
      <MessageComposer
        text={draft.text}
        onChangeText={draft.setText}
        canSend
        placeholder="Комментарий"
        plate={plate}
        edit={editPlate?.state}
        inputRef={inputRef}
        onSend={onSend}
        onTyping={noop}
        onFieldActivate={claimKeyboardForComments}
        onAttachPressIn={armSheet}
        onAttachPressOut={releaseMediaSheetArm}
        onAttachPress={openSheet}
        onSendVoice={isEditing ? edit.recorded : onSendVoice}
      />

      <MediaPickerSheet
        owner="comments"
        draft={draft}
        plate={isEditing ? plate : null}
        editing={isEditing}
        placeholder="Комментарий"
        onTyping={noop}
        onSend={onSend}
      />
    </>
  );
}
