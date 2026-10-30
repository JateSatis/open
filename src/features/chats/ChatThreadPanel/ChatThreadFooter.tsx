import { View } from 'react-native';

import { styles } from './styles';
import type { useChatThreadActions } from './useChatThreadActions';

import { modePlate } from '@/features/chats/ChatFooter';
import { claimKeyboardForComments } from '@/features/chats/composerKeyboard';
import {
  armMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { MessageComposer } from '@/features/chats/MessageComposer';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { useTheme } from '@/hooks/use-theme';

export type ChatThreadFooterProps = {
  actions: ReturnType<typeof useChatThreadActions>;
  currentUserId: string | null;
  isMember: boolean;
  /** Подпись шита медиа — чат. */
  title: string;
  onTyping: () => void;
  onRecordingVoice: () => void;
};

const PLACEHOLDER = 'Ответить в треде';
const armSheet = () => armMediaSheet('chat-thread');
const openSheet = () => openMediaSheet('chat-thread');

/**
 * Низ шторки треда: поле ввода участника — то же, что под перепиской:
 * текст, скрытое от зрителей, медиа, голосовое и правка; в режиме выбора —
 * панель действий. Ответ по умолчанию — исходному сообщению, поэтому его
 * плашки над полем нет. Постороннему писать некуда — поля нет.
 */
export function ChatThreadFooter({
  actions,
  currentUserId,
  isMember,
  title,
  onTyping,
  onRecordingVoice,
}: ChatThreadFooterProps) {
  const theme = useTheme();
  const { draft, edit, selection, isEditing } = actions;

  if (!isMember) {
    return selection.isActive ? (
      <SelectionActionBar
        context={{ selected: selection.selected, currentUserId, isMember }}
        onAction={actions.runSelectionAction}
      />
    ) : null;
  }

  const editPlate = edit.composer
    ? {
        onRemoveAttachment: edit.removeAttachment,
        onRemoveVoice: edit.removeVoice,
        state: edit.composer,
      }
    : undefined;
  const closeMode = () => (isEditing ? void edit.leave() : draft.setMode(null));
  const plate = modePlate(draft.mode, closeMode, editPlate);

  return (
    <View
      testID="chat-thread-footer"
      style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      {selection.isActive ? (
        <SelectionActionBar
          context={{ selected: selection.selected, currentUserId, isMember }}
          onAction={actions.runSelectionAction}
        />
      ) : null}
      {/* Поле прячется, а не размонтируется: черновик и рекордер остаются. */}
      <View style={selection.isActive ? styles.hidden : undefined}>
        <MessageComposer
          text={draft.text}
          onChangeText={draft.setText}
          canSend
          placeholder={PLACEHOLDER}
          plate={plate}
          edit={editPlate?.state}
          inputRef={actions.composerRef}
          onSend={actions.submit}
          onTyping={onTyping}
          onFieldActivate={claimKeyboardForComments}
          keyboardOwner="comments"
          onAttachPressIn={armSheet}
          onAttachPressOut={releaseMediaSheetArm}
          onAttachPress={openSheet}
          onSendVoice={actions.sendVoice}
          onRecordingVoice={isEditing ? undefined : onRecordingVoice}
          hidden={{ ranges: draft.hidden, onChange: draft.setHidden }}
        />
      </View>

      <MediaPickerSheet
        owner="chat-thread"
        draft={draft}
        plate={draft.mode?.type === 'reply' || isEditing ? plate : null}
        editing={isEditing}
        placeholder={PLACEHOLDER}
        title={title}
        onTyping={onTyping}
        onSend={actions.submit}
      />
    </View>
  );
}
