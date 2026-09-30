import type { RefObject } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import type { MyInvite } from '@/api/invites';
import { ComposerPlate } from '@/features/chats/ComposerPlate';
import type { ComposerMode } from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import { InviteResponseBar } from '@/features/chats/InviteResponseBar';
import {
  armMediaSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { EditAttachments } from '@/features/chats/EditAttachments';
import { MessageComposer, type MessageComposerProps } from '@/features/chats/MessageComposer';
import { describeMode } from '@/features/chats/messageQuote';
import type { SelectionActionContext, SelectionActionId } from '@/features/chats/messageActions';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import type { LocalMedia } from '@/features/media';

/** Что можно сделать с вложениями правки прямо под плашкой. */
export type EditPlateHandlers = {
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveVoice: () => void;
};

/**
 * Плашка режима — ответ, пересылка или правка — с крестиком, снимающим режим.
 * У правки под плашкой её вложения.
 */
export function modePlate(
  mode: ComposerMode | null,
  onClose: () => void,
  edit?: EditPlateHandlers,
) {
  if (!mode) return null;

  const plate = <ComposerPlate {...describeMode(mode)} onClose={onClose} />;

  if (mode.type !== 'edit' || !edit) return plate;

  return (
    <>
      {plate}
      <EditAttachments
        kept={mode.kept}
        voice={mode.voice}
        onRemoveAttachment={edit.onRemoveAttachment}
        onRemoveVoice={edit.onRemoveVoice}
      />
    </>
  );
}

export type ChatFooterProps = {
  selection: {
    isActive: boolean;
    context: SelectionActionContext;
    onAction: (id: SelectionActionId) => void;
  };
  /** Моя заявка в этот чат, пока я не участник и ещё не ответил на неё. */
  invite: {
    value: MyInvite;
    responding: 'accept' | 'decline' | null;
    error: string | null;
    onAccept: () => void;
    onDecline: () => void;
  } | null;
  composer: {
    text: string;
    onChangeText: (text: string) => void;
    mode: ComposerMode | null;
    onCloseMode: () => void;
    /** Правка: что можно сделать с вложениями и что доступно в поле. */
    edit?: EditPlateHandlers & { state: NonNullable<MessageComposerProps['edit']> };
    canSend: boolean;
    onSend: () => void;
    onTyping: () => void;
    onSendVoice: (voice: LocalMedia) => void;
    onRecordingVoice: () => void;
    inputRef: RefObject<TextInput | null>;
  };
};

/**
 * Низ переписки: панель выбора, ответ на заявку или поле ввода с плашкой
 * режима. Что из них видно, решает состояние экрана; поле при этом не
 * размонтируется.
 */
export function ChatFooter({ selection, invite, composer }: ChatFooterProps) {
  return (
    <>
      {selection.isActive ? (
        <SelectionActionBar context={selection.context} onAction={selection.onAction} />
      ) : null}

      {invite ? (
        selection.isActive ? null : (
          <InviteResponseBar
            invite={invite.value}
            responding={invite.responding}
            error={invite.error}
            onAccept={invite.onAccept}
            onDecline={invite.onDecline}
          />
        )
      ) : (
        // На время выбора поле ввода прячется, а не размонтируется: черновик
        // и заранее подготовленный рекордер голосовых остаются как были.
        <View style={selection.isActive ? styles.hidden : undefined}>
          <MessageComposer
            text={composer.text}
            onChangeText={composer.onChangeText}
            canSend={composer.canSend}
            canSendEmpty={composer.mode?.type === 'forward'}
            plate={modePlate(composer.mode, composer.onCloseMode, composer.edit)}
            edit={composer.edit?.state}
            inputRef={composer.inputRef}
            onSend={composer.onSend}
            onTyping={composer.onTyping}
            onFieldActivate={claimKeyboardForChat}
            onAttachPressIn={armMediaSheet}
            onAttachPressOut={releaseMediaSheetArm}
            onAttachPress={openMediaSheet}
            onSendVoice={composer.onSendVoice}
            onRecordingVoice={composer.onRecordingVoice}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hidden: {
    display: 'none',
  },
});
