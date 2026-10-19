import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { AreaHeader } from './AreaHeader';
import { ClusterHeader } from './ClusterHeader';
import { PanelContent } from './PanelContent';
import { styles } from './styles';
import { useSidePanel } from './useSidePanel';

import { ConfirmDialogSurface } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import type {
  CommentsPanelTarget,
  FragmentPanelSubject,
} from '@/features/interactions/comments/commentsPanelStore';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';
import { closeEmojiPanel } from '@/features/chats/EmojiPanel';

export type FragmentPanelWindowProps = {
  target: CommentsPanelTarget & { fragment: FragmentPanelSubject };
  onOpenPerson: (userId: string) => void;
  hostChatId?: string;
};

/**
 * Боковая панель куска текста — кластера или выделенной области: справа, на
 * 90% ширины, слева видна затемнённая переписка. Сверху — цитата и сводные
 * реакции, ниже — комментарии фрагментов куска с тредами, медиа, голосовыми и
 * закрепом, у каждого — плашка его цитаты; внизу — поле ввода.
 * Содержимое — то же, что у шита комментариев (`PanelContent`), меняется
 * только окно. Своё окно (`Modal`) — иначе шапку экрана не перекрыть.
 */
export function FragmentPanelWindow({ target, onOpenPerson, hostChatId }: FragmentPanelWindowProps) {
  const theme = useTheme();
  const { width: screenWidth, height: appWindowHeight } = useWindowDimensions();
  const [windowHeight, setWindowHeight] = useState(appWindowHeight);
  const width = Math.round(screenWidth * Sizes.fragmentPanelShare);
  const panel = useSidePanel({ width, windowHeight });
  const backRef = useRef<() => boolean>(() => false);
  const { close, markShown } = panel;

  // Поле чата под панелью теряет фокус: иначе клавиатура вернулась бы к нему.
  useEffect(() => Keyboard.dismiss(), []);

  /** «Назад» отвечает на вопрос, потом выходит из правки, выбора и треда и только потом закрывает. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    // «Назад» в окне приходит сюда, а не в BackHandler: панель эмодзи — первой.
    if (closeEmojiPanel()) return;
    if (backRef.current()) return;

    close();
  }, [close]);

  const { fragment } = target;

  return (
    <Modal
      testID="fragment-panel"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
      onShow={markShown}
    >
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[styles.fill, { backgroundColor: theme.overlay }, panel.backdropStyle]}
        >
          <Pressable
            testID="fragment-panel-backdrop"
            accessibilityLabel="Закрыть панель фрагмента"
            style={styles.fill}
            onPress={close}
          />
        </Animated.View>

        <Animated.View style={[styles.sidePanel, { width }]} pointerEvents="box-none">
          <PanelContent
            target={target}
            sheet={panel}
            onOpenPerson={onOpenPerson}
            hostChatId={hostChatId}
            backRef={backRef}
            width={width}
            focusInput={fragment.focusInput && panel.opened}
            header={{
              title: 'Фрагмент',
              extra:
                fragment.kind === 'cluster' ? (
                  <ClusterHeader
                    messageId={target.subject.id}
                    chatId={target.chatId ?? ''}
                    subject={fragment}
                    amMember={target.amMember ?? false}
                    width={width}
                  />
                ) : (
                  <AreaHeader
                    messageId={target.subject.id}
                    subject={fragment}
                    amMember={target.amMember ?? false}
                    width={width}
                  />
                ),
            }}
          />
        </Animated.View>

        <ConfirmDialogSurface />
        <InAppNoticeToast />
      </GestureHandlerRootView>
    </Modal>
  );
}
