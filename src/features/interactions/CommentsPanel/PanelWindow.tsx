// Панель на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, useWindowDimensions } from 'react-native';
import { Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PanelContent } from './PanelContent';
import { styles } from './styles';

import { ConfirmDialogSurface } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { CLOSE_DURATION_MS, OPEN_SPRING } from '@/features/chats/MediaPickerSheet/geometry';
import {
  closeComments,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Столько протащить шапку вниз (или бросить быстрее), чтобы панель ушла. */
const DISMISS_DISTANCE = Sizes.swipeReplyMax * 1.5;
const DISMISS_VELOCITY = 800;

export type PanelWindowProps = {
  target: CommentsPanelTarget;
  topInset: number;
  onOpenPerson: (userId: string) => void;
};

/**
 * Панель комментариев поверх переписки. Своё окно (`Modal`): таб-бар и шапка
 * экрана нативные, оверлей внутри экрана их не перекроет (см. шит медиа).
 * Панель встаёт под шапкой экрана — шапка остаётся видна, — а переписка
 * под панелью не двигается: клавиатурой владеет поле панели.
 */
export function PanelWindow({ target, topInset, onOpenPerson }: PanelWindowProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useOwnKeyboardHeight('comments');
  const offset = useSharedValue(windowHeight);
  const [shown, setShown] = useState(false);
  const closing = useSharedValue(false);
  const backRef = useRef<() => boolean>(() => false);

  // Поле чата под панелью теряет фокус: иначе клавиатура вернулась бы к нему.
  useEffect(() => Keyboard.dismiss(), []);

  useEffect(() => {
    if (shown) offset.value = withSpring(0, OPEN_SPRING);
  }, [offset, shown]);

  const close = useCallback(() => {
    if (closing.value) return;

    closing.value = true;
    void KeyboardController.dismiss();
    offset.value = withTiming(windowHeight, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(closeComments)();
    });
  }, [closing, offset, windowHeight]);

  /** «Назад» отвечает на вопрос, потом выходит из правки и только потом закрывает панель. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    if (backRef.current()) return;

    close();
  }, [close]);

  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(Sizes.swipeReplyActivation / 2)
        .failOffsetY(-Sizes.swipeReplyActivation / 2)
        .onUpdate((event) => {
          offset.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
            runOnJS(close)();
            return;
          }

          offset.value = withSpring(0, OPEN_SPRING);
        }),
    [close, offset],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    // Поле ввода — над клавиатурой своего поля; без неё — над полосой навигации.
    paddingBottom: Math.max(keyboardHeight.value, insets.bottom),
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, windowHeight], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <Modal
      testID="comments-panel"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
      onShow={() => setShown(true)}
    >
      {/* Своё окно на Android — свой корень жестов, как у шита медиа. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.fill, { backgroundColor: theme.overlay }, backdropStyle]}>
          <Pressable
            testID="comments-backdrop"
            accessibilityLabel="Закрыть комментарии"
            style={styles.fill}
            onPress={close}
          />
        </Animated.View>

        <Animated.View
          style={[styles.panel, { top: topInset, backgroundColor: theme.background }, panelStyle]}
        >
          <PanelContent
            target={target}
            dismissGesture={dismissGesture}
            onClose={close}
            onOpenPerson={onOpenPerson}
            backRef={backRef}
          />
        </Animated.View>

        {/* Вопросы и короткие ответы — внутри окна панели, иначе их не видно. */}
        <ConfirmDialogSurface />
        <InAppNoticeToast />
      </GestureHandlerRootView>
    </Modal>
  );
}
