// Панель на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { panelSnaps, resolvePanelSnap, snapTop, type PanelSnaps } from './panelGeometry';
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

/** Жест шита считается вертикальным после этого сдвига — тапы по сообщению доживают до своих кнопок. */
const DRAG_ACTIVATION = 8;
/** Быстрее этого уход вниз не бывает, как бы быстро ни бросили. */
const MIN_CLOSE_MS = 120;

export type PanelWindowProps = {
  target: CommentsPanelTarget;
  topInset: number;
  onOpenPerson: (userId: string) => void;
};

/**
 * Сколько ехать вниз после броска: со скоростью пальца, чтобы уход был одним
 * непрерывным движением, но не дольше обычного закрытия.
 */
function closeDuration(distance: number, velocityY: number): number {
  'worklet';

  if (velocityY <= 0) return CLOSE_DURATION_MS;

  return Math.max(MIN_CLOSE_MS, Math.min(CLOSE_DURATION_MS, (distance / velocityY) * 1000));
}

/**
 * Панель комментариев поверх переписки. Своё окно (`Modal`): таб-бар и шапка
 * экрана нативные, оверлей внутри экрана их не перекроет (см. шит медиа).
 *
 * Три положения — полное (80% экрана), половина (низ исходного сообщения на
 * середине экрана) и закрыто, см. `panelGeometry`. Между половиной и полным
 * двигается только верх шита, а низ с полем ввода стоит у края экрана:
 * список держится за низ, и новые комментарии не прыгают. Ниже половины шит
 * уезжает целиком. Тянут за ручку и за исходное сообщение; список листается
 * сам по себе и шит не разворачивает.
 */
export function PanelWindow({ target, topInset, onOpenPerson }: PanelWindowProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: appWindowHeight } = useWindowDimensions();
  // Окно `Modal` с прозрачными системными полосами — во весь экран, выше окна
  // приложения на полосу навигации. Середина и низ — по нему, иначе половина
  // съезжала бы вниз, а закрытый шит выглядывал из-под полосы.
  const [windowHeight, setWindowHeight] = useState(appWindowHeight);
  const keyboardHeight = useOwnKeyboardHeight('comments');
  /** Верх шита в окне. */
  const top = useSharedValue(windowHeight);
  const snaps = useSharedValue<PanelSnaps>(panelSnaps(windowHeight, topInset, 0));
  const dragStart = useSharedValue(0);
  const closing = useSharedValue(false);
  const headerHeight = useSharedValue(0);
  const composerHeight = useSharedValue(0);
  const [shown, setShown] = useState(false);
  const [regionBottom, setRegionBottom] = useState<number | null>(null);
  const opened = useRef(false);
  const backRef = useRef<() => boolean>(() => false);

  // Поле чата под панелью теряет фокус: иначе клавиатура вернулась бы к нему.
  useEffect(() => Keyboard.dismiss(), []);

  // Положения считаются по высоте сообщения: она известна после раскладки, и
  // шит выезжает только тогда — сразу в половину, без подскока.
  useEffect(() => {
    if (regionBottom === null) return;

    snaps.value = panelSnaps(windowHeight, topInset, regionBottom);

    if (!shown || opened.current) return;

    opened.current = true;
    top.value = withSpring(snapTop('half', snaps.value), OPEN_SPRING);
  }, [regionBottom, shown, snaps, top, topInset, windowHeight]);

  const close = useCallback(
    (velocityY = 0) => {
      if (closing.value) return;

      closing.value = true;
      void KeyboardController.dismiss();
      top.value = withTiming(
        windowHeight,
        { duration: closeDuration(windowHeight - top.value, velocityY) },
        (finished) => {
          if (finished) runOnJS(closeComments)();
        },
      );
    },
    [closing, top, windowHeight],
  );

  const closeNow = useCallback(() => close(), [close]);

  /** Поле ввода в фокусе — шит разворачивается: комментариям нужно место над клавиатурой. */
  const expand = useCallback(() => {
    if (closing.value) return;

    top.value = withSpring(snaps.value.full, OPEN_SPRING);
  }, [closing, snaps, top]);

  /** «Назад» отвечает на вопрос, потом выходит из правки и только потом закрывает панель. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    if (backRef.current()) return;

    close();
  }, [close]);

  // Жест — фабрикой: один и тот же объект нельзя отдать двум детекторам, а
  // тянут и за шапку, и за сообщение.
  const makeDragGesture = useCallback(
    () =>
      Gesture.Pan()
        .activeOffsetY([-DRAG_ACTIVATION, DRAG_ACTIVATION])
        .onStart(() => {
          dragStart.value = top.value;
        })
        .onUpdate((event) => {
          if (closing.value) return;

          top.value = Math.max(snaps.value.full, dragStart.value + event.translationY);
        })
        .onEnd((event) => {
          if (closing.value) return;

          const snap = resolvePanelSnap(top.value, event.velocityY, snaps.value);

          if (snap === 'closed') {
            runOnJS(close)(event.velocityY);
            return;
          }

          top.value = withSpring(snapTop(snap, snaps.value), {
            ...OPEN_SPRING,
            velocity: event.velocityY,
          });
        }),
    [close, closing, dragStart, snaps, top],
  );

  const panelStyle = useAnimatedStyle(() => {
    const lowest = snaps.value.half ?? snaps.value.full;

    return {
      // До нижнего положения меняется раскладка: верх едет, низ стоит. Ниже —
      // шит уезжает целиком, сдвигом.
      top: Math.min(top.value, lowest),
      transform: [{ translateY: Math.max(0, top.value - lowest) }],
      // Поле ввода — над клавиатурой своего поля; без неё — над полосой навигации.
      paddingBottom: Math.max(keyboardHeight.value, insets.bottom),
    };
  });

  /**
   * Исходному сообщению — сколько останется после шапки, поля ввода и
   * минимума списка. Без потолка колонка шита при клавиатуре сминала бы
   * что попало, и сообщение пропадало.
   */
  const targetStyle = useAnimatedStyle(() => {
    const lowest = snaps.value.half ?? snaps.value.full;
    const panelTop = Math.min(top.value, lowest);
    const room =
      windowHeight -
      panelTop -
      Math.max(keyboardHeight.value, insets.bottom) -
      headerHeight.value -
      composerHeight.value -
      Sizes.commentsListMin;

    return { maxHeight: Math.max(Sizes.commentTargetMin, room) };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      top.value,
      [snaps.value.half ?? snaps.value.full, windowHeight],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const measureRegion = useCallback(
    (bottom: number) => {
      // Пока открыта клавиатура, сообщение ужато потолком — половину по нему
      // не считаем.
      if (keyboardHeight.value === 0) setRegionBottom(bottom);
    },
    [keyboardHeight],
  );

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
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Animated.View style={[styles.fill, { backgroundColor: theme.overlay }, backdropStyle]}>
          <Pressable
            testID="comments-backdrop"
            accessibilityLabel="Закрыть комментарии"
            style={styles.fill}
            onPress={closeNow}
          />
        </Animated.View>

        <Animated.View style={[styles.panel, { backgroundColor: theme.background }, panelStyle]}>
          <PanelContent
            target={target}
            makeDragGesture={makeDragGesture}
            targetStyle={targetStyle}
            onRegionLayout={measureRegion}
            onHeaderLayout={(height) => {
              headerHeight.value = height;
            }}
            onComposerLayout={(height) => {
              composerHeight.value = height;
            }}
            onFieldActivate={expand}
            onClose={closeNow}
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
