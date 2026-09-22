import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetModal,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import { BackHandler, Pressable, View } from 'react-native';

import { styles } from './styles';

import { confirm } from '@/components/ConfirmDialog';
import { Text } from '@/components/Text';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { MediaGrid, type MediaListComponent } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MediaPickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

const SNAP_POINTS = ['55%', '100%'];

/**
 * Список грида внутри шита обязан быть `BottomSheetFlatList`, а не обычным
 * `FlatList`: только так его скролл становится частью того же жеста, что и
 * сам шит (тянется вместе с содержимым, пока не упрётся в верх — см. п. 4
 * задачи про поведение как в Telegram). `enableFooterMarginAdjustment`
 * держит нижние клетки грида видимыми поверх закреплённого композера.
 */
const SheetMediaList: MediaListComponent = (props) => (
  <BottomSheetFlatList {...props} enableFooterMarginAdjustment />
);

/**
 * Выбор медиа живёт в `@gorhom/bottom-sheet` — библиотека умеет то, что не
 * умеет нативный шит из `@expo/ui`: связать скролл контента с высотой шита
 * (раскрывается по мере скролла, а не прыжком) и держать футер (поле ввода)
 * прибитым к низу независимо от снап-поинта.
 *
 * Закрытие с выбранными файлами всегда спрашивает подтверждение. Свайпом
 * закрыть шит с непустым выбором нельзя вовсе (жест просто пружинит назад к
 * ближайшему снап-поинту) — только явным нажатием на крестик, тапом по
 * фону или системной кнопкой «назад», а эти три пути гарантированно ведут
 * через `requestClose()`. Это сознательное упрощение относительно Telegram,
 * где свайп можно прервать модалкой на середине анимации: тут это
 * потребовало бы отменять уже отыгравшую анимацию закрытия ценой заметного
 * «моргания» (закрылся и тут же снова открылся), а честный запрет жеста при
 * выбранных файлах даёт тот же результат без этого артефакта.
 */
export function MediaPickerSheet({ visible, onDismiss, draft, onTyping, onSend }: MediaPickerSheetProps) {
  const theme = useTheme();
  const sheetRef = useRef<ComponentRef<typeof BottomSheetModal>>(null);
  const hasMedia = draft.media.length > 0;
  const hasMediaRef = useRef(hasMedia);

  useEffect(() => {
    hasMediaRef.current = hasMedia;
  }, [hasMedia]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const requestClose = useCallback(() => {
    if (!hasMediaRef.current) {
      sheetRef.current?.dismiss();
      return;
    }

    void confirm({
      title: 'Отменить выбор файлов?',
      message: 'Выбранные фото и видео не будут отправлены.',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
      destructive: true,
    }).then((discard) => {
      if (!discard) return;

      draft.clearMedia();
      sheetRef.current?.dismiss();
    });
  }, [draft]);

  // @gorhom/bottom-sheet не перехватывает аппаратную кнопку «Назад» сам —
  // без этого она закрыла бы весь экран чата поверх шита, минуя проверку.
  useEffect(() => {
    if (!visible) return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });

    return () => subscription.remove();
  }, [visible, requestClose]);

  const submit = useCallback(() => {
    onSend();
    onDismiss();
  }, [onSend, onDismiss]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior={hasMedia ? 'none' : 'close'}
        onPress={requestClose}
      />
    ),
    [hasMedia, requestClose],
  );

  const renderHandle = useCallback(
    () => (
      <View style={[styles.handle, { backgroundColor: theme.background }]}>
        <View style={[styles.handleBar, { backgroundColor: theme.border }]} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          hitSlop={Spacing.two}
          onPress={requestClose}
          style={styles.closeButton}
        >
          <Text color="textSecondary">✕</Text>
        </Pressable>
      </View>
    ),
    [requestClose, theme],
  );

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter {...footerProps}>
        <MessageComposer
          text={draft.text}
          onChangeText={draft.setText}
          media={draft.media}
          onSend={submit}
          onTyping={onTyping}
          canSend
        />
      </BottomSheetFooter>
    ),
    [draft.text, draft.media, draft.setText, onTyping, submit],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose={!hasMedia}
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      footerComponent={hasMedia ? renderFooter : undefined}
      backgroundStyle={{ backgroundColor: theme.background }}
      onDismiss={onDismiss}
    >
      <MediaGrid selected={draft.media} onToggle={draft.toggleMedia} ListComponent={SheetMediaList} />
    </BottomSheetModal>
  );
}
