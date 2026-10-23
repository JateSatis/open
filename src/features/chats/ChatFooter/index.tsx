import type { RefObject } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import type { MyInvite } from '@/api/invites';
import { ComposerPlate } from '@/features/chats/ComposerPlate';
import type { ComposerMode } from '@/features/chats/composerDraftStore';
import { ChatSubscribeBar } from '@/features/chats/ChatSubscribeBar';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import { InviteResponseBar } from '@/features/chats/InviteResponseBar';
import { RequestSentBar } from '@/features/chats/RequestSentBar';
import {
  armMediaSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { EditAttachments } from '@/features/chats/EditAttachments';
import { MessageComposer, type MessageComposerProps } from '@/features/chats/MessageComposer';
import { PopAttachmentChip, type PopAttachmentChipProps } from '@/features/chats/PopAttachmentChip';
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
  /** Посторонний без подписки в чужом диалоге или группе: «Подписаться». */
  subscribe: { chatId: string } | null;
  /** Я отправил заявку на диалог, её ещё не приняли: писать нельзя. */
  requestSent?: boolean;
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
    /** Экран чата на виду: под открытым поверх экраном панель эмодзи не держится. */
    screenFocused?: boolean;
    /** Скрытое от зрителей в тексте черновика; в канале — нет. */
    hidden?: MessageComposerProps['hidden'];
    /** Поп, прикреплённый к посту канала. С ним пост уходит и без текста. */
    pop?: Pick<PopAttachmentChipProps, 'posterUri' | 'onRemove'> | null;
  } | null;
};

/**
 * Низ переписки: панель выбора, ответ на заявку, «Подписаться» или поле ввода
 * с плашкой режима. Что из них видно, решает состояние экрана; поле при этом
 * не размонтируется.
 */
export function ChatFooter({
  selection,
  invite,
  subscribe,
  requestSent = false,
  composer,
}: ChatFooterProps) {
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
      ) : subscribe ? (
        selection.isActive ? null : (
          <ChatSubscribeBar chatId={subscribe.chatId} />
        )
      ) : requestSent ? (
        selection.isActive ? null : (
          <RequestSentBar />
        )
      ) : composer ? (
        // На время выбора поле ввода прячется, а не размонтируется: черновик
        // и заранее подготовленный рекордер голосовых остаются как были.
        <View style={selection.isActive ? styles.hidden : undefined}>
          <MessageComposer
            text={composer.text}
            onChangeText={composer.onChangeText}
            canSend={composer.canSend}
            canSendEmpty={
              composer.mode?.type === 'forward' ||
              composer.mode?.type === 'forward_comments' ||
              Boolean(composer.pop)
            }
            plate={
              <>
                {modePlate(composer.mode, composer.onCloseMode, composer.edit)}
                {composer.pop ? <PopAttachmentChip {...composer.pop} standalone /> : null}
              </>
            }
            edit={composer.edit?.state}
            hidden={composer.hidden}
            inputRef={composer.inputRef}
            screenFocused={composer.screenFocused}
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
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hidden: {
    display: 'none',
  },
});
