import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { PanelContent } from './PanelContent';
import { styles } from './styles';
import { useCommentsLift } from './useCommentsLift';
import { usePanelSheet } from './usePanelSheet';

import { ConfirmDialogSurface } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import type { CommentsLiftHost } from '@/features/interactions/comments/commentsLift';
import type { CommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';

export type PanelWindowProps = {
  target: CommentsPanelTarget;
  onOpenPerson: (userId: string) => void;
  hostChatId?: string;
  /** Переписка под шитом — её сообщение поднимается над ним. */
  lift?: CommentsLiftHost;
};

/**
 * Панель комментариев поверх переписки. Своё окно (`Modal`): таб-бар и шапка
 * экрана нативные, оверлей внутри экрана их не перекроет (см. шит медиа).
 *
 * Шит стоит верхом на четверти экрана (`panelGeometry`), над ним — копия
 * сообщения из переписки (`useCommentsLift`). Фон окна прозрачный и только
 * ловит тап: тап над шитом, в том числе по сообщению, закрывает шит.
 */
export function PanelWindow({ target, onOpenPerson, hostChatId, lift }: PanelWindowProps) {
  const { height: appWindowHeight } = useWindowDimensions();
  // Окно `Modal` с прозрачными системными полосами — во весь экран, выше окна
  // приложения на полосу навигации. Положения — по нему, иначе закрытый шит
  // выглядывал бы из-под полосы.
  const [windowHeight, setWindowHeight] = useState(appWindowHeight);
  const [shown, setShown] = useState(false);
  // Шит и подъём нужны друг другу: подъём едет по ходу шита, а шит перед
  // закрытием просит подъём перемерить переписку.
  const prepareRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const prepareClose = useCallback(() => prepareRef.current(), []);
  const sheet = usePanelSheet({ windowHeight, prepareClose });
  const lifted = useCommentsLift({
    host: lift,
    rowKey: target.rowKey,
    settle: target.settle ?? false,
    shown,
    geometry: sheet.geometry,
    dismissY: sheet.dismissY,
  });
  const backRef = useRef<() => boolean>(() => false);
  const { close, markShown, markReady } = sheet;

  useEffect(() => {
    prepareRef.current = lifted.prepareClose;
  }, [lifted.prepareClose]);

  useEffect(() => {
    if (lifted.ready) markReady();
  }, [lifted.ready, markReady]);

  // Поле чата под панелью теряет фокус: иначе клавиатура вернулась бы к нему.
  useEffect(() => Keyboard.dismiss(), []);

  const onShow = useCallback(() => {
    setShown(true);
    markShown();
  }, [markShown]);

  /** «Назад» отвечает на вопрос, потом выходит из правки и выбора и только потом закрывает панель. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    if (backRef.current()) return;

    close();
  }, [close]);

  const { copy } = lifted;

  return (
    <Modal
      testID="comments-panel"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
      onShow={onShow}
    >
      {/* Своё окно на Android — свой корень жестов, как у шита медиа. */}
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Pressable
          testID="comments-backdrop"
          accessibilityLabel="Закрыть комментарии"
          style={styles.fill}
          onPress={sheet.closeNow}
        />

        {copy && lift ? (
          // Копия касаний не ловит: тап по ней достаётся фону и закрывает шит.
          <View
            pointerEvents="none"
            style={[
              styles.liftClip,
              { top: copy.area.top, height: copy.area.bottom - copy.area.top },
            ]}
          >
            <Animated.View
              testID="comments-lifted-message"
              style={[
                styles.liftedCopy,
                { left: copy.anchor.x, width: copy.anchor.width },
                lifted.copyStyle,
              ]}
              onLayout={lifted.onCopyLayout}
            >
              {lift.renderRow(copy.rowKey)}
            </Animated.View>
          </View>
        ) : null}

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
