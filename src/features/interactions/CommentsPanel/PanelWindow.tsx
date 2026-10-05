import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { PanelContent } from './PanelContent';
import { styles } from './styles';
import { usePanelSheet } from './usePanelSheet';

import { ConfirmDialogSurface } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import type { CommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useTheme } from '@/hooks/use-theme';

export type PanelWindowProps = {
  target: CommentsPanelTarget;
  onOpenPerson: (userId: string) => void;
  hostChatId?: string;
};

/**
 * Панель комментариев поверх переписки. Своё окно (`Modal`): таб-бар и шапка
 * экрана нативные, оверлей внутри экрана их не перекроет (см. шит медиа).
 *
 * Положения — верхнее (низ исходного сообщения на 20% экрана), среднее (на
 * середине) и закрыто, см. `panelGeometry`; между средним и верхним шит
 * останавливается там, где его отпустили, как шит медиа.
 */
export function PanelWindow({ target, onOpenPerson, hostChatId }: PanelWindowProps) {
  const theme = useTheme();
  const { height: appWindowHeight } = useWindowDimensions();
  // Окно `Modal` с прозрачными системными полосами — во весь экран, выше окна
  // приложения на полосу навигации. Положения — по нему, иначе середина
  // съезжала бы вниз, а закрытый шит выглядывал из-под полосы.
  const [windowHeight, setWindowHeight] = useState(appWindowHeight);
  const sheet = usePanelSheet(windowHeight);
  const backRef = useRef<() => boolean>(() => false);
  const { close, markShown } = sheet;

  // Поле чата под панелью теряет фокус: иначе клавиатура вернулась бы к нему.
  useEffect(() => Keyboard.dismiss(), []);

  /** «Назад» отвечает на вопрос, потом выходит из правки и выбора и только потом закрывает панель. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    if (backRef.current()) return;

    close();
  }, [close]);

  return (
    <Modal
      testID="comments-panel"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
      onShow={markShown}
    >
      {/* Своё окно на Android — свой корень жестов, как у шита медиа. */}
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Animated.View style={[styles.fill, { backgroundColor: theme.overlay }, sheet.backdropStyle]}>
          <Pressable
            testID="comments-backdrop"
            accessibilityLabel="Закрыть комментарии"
            style={styles.fill}
            onPress={sheet.closeNow}
          />
        </Animated.View>

        <PanelContent
          target={target}
          sheet={sheet}
          onOpenPerson={onOpenPerson}
          hostChatId={hostChatId}
          backRef={backRef}
        />

        {/* Вопросы и короткие ответы — внутри окна панели, иначе их не видно. */}
        <ConfirmDialogSurface />
        <InAppNoticeToast />
      </GestureHandlerRootView>
    </Modal>
  );
}
