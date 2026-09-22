import { BottomSheetModal, BottomSheetView, type BottomSheetMethods } from '@expo/ui/community/bottom-sheet';
import { useEffect, useRef } from 'react';

import { styles } from './styles';

import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { MediaGrid } from '@/features/media';

export type MediaPickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

/**
 * Выбор медиа живёт в нативном bottom sheet (`@expo/ui`) — уже установлен в
 * проекте, свайп вниз и разворот на весь экран работают из коробки на обеих
 * платформах, отдельный gorhom/bottom-sheet не нужен.
 *
 * Поле ввода внизу шита — тот же черновик, что и под чатом: закрыть шит не
 * значит потерять текст или выбор.
 */
export function MediaPickerSheet({ visible, onDismiss, draft, onTyping, onSend }: MediaPickerSheetProps) {
  const sheetRef = useRef<BottomSheetMethods>(null);
  const hadMediaRef = useRef(false);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
      hadMediaRef.current = false;
    }
  }, [visible]);

  // На частичном снапе Android раскладывает содержимое шита на всю его
  // высоту и просто не показывает нижнюю часть — строка ввода вместе с
  // выбранным файлом ушла бы за нижний край экрана, если её не сделать
  // видимой явно. Разворот на весь экран ровно в момент появления первого
  // файла — самый прямой способ показать её сразу, без свайпа руками.
  useEffect(() => {
    const hasMedia = draft.media.length > 0;

    if (hasMedia && !hadMediaRef.current) {
      sheetRef.current?.expand();
    }

    hadMediaRef.current = hasMedia;
  }, [draft.media.length]);

  const submit = () => {
    onSend();
    onDismiss();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['65%', '100%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      onDismiss={onDismiss}
    >
      <BottomSheetView style={styles.container}>
        <MediaGrid selected={draft.media} onToggle={draft.toggleMedia} />

        {draft.media.length > 0 ? (
          <MessageComposer
            text={draft.text}
            onChangeText={draft.setText}
            media={draft.media}
            onRemoveMedia={draft.removeMedia}
            onSend={submit}
            onTyping={onTyping}
            canSend
          />
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
}
