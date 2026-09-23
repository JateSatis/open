// Компонент завязан на низкоуровневый API Reanimated напрямую (без
// @gorhom/bottom-sheet, см. комментарий ниже по файлу): мутация `.value` у
// shared value — единственный штатный способ им пользоваться, а не
// нарушение чистоты, которое видит в этом React Compiler. Запуск анимации
// сразу при появлении шита в эффекте — тоже осознанное действие, а не
// побочный каскад рендеров.
/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
  type FlatList,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HANDLE_BLOCK_HEIGHT, styles } from './styles';

import { confirm } from '@/components/ConfirmDialog';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { MediaGrid, type MediaListComponent, type MediaLibraryItem } from '@/features/media';
import { countRender } from '@/features/media/perf';
import { useMediaSelection, useSelectionCount } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';

export type MediaPickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

/** Жест закрытия — снаружи нужен только тестам, поэтому лежит рядом с самим жестом. */
export const SHEET_PAN_TEST_ID = 'media-picker-pan';

/** Доля экрана, на которую шит открывается по кнопке медиа. */
const COLLAPSED_RATIO = 0.55;
const OPEN_SPRING = { damping: 32, stiffness: 300, mass: 0.9 };
const CLOSE_DURATION_MS = 220;
/** Утащили шит ниже этой доли свёрнутой высоты — отпускание закрывает его. */
const DISMISS_RATIO = 0.2;
const FLING_VELOCITY = 800;
/** Жест считается вертикальным после этого сдвига — иначе тап по кружку не доживал бы до Pressable. */
const PAN_ACTIVATION_PX = 8;

/**
 * Свой шит на голых `react-native-gesture-handler` + `react-native-reanimated`
 * вместо `@gorhom/bottom-sheet`: библиотека не работает с Reanimated 4 —
 * `present()` отрабатывает без ошибок, но шит физически не появляется.
 * Проверено на последней опубликованной версии (5.2.14), обходного пути в
 * апстриме нет.
 *
 * Главное в устройстве: **движением владеет список, а не шит**. Положение
 * шита не двигают жестом — оно вычисляется из `scrollOffset` списка в
 * worklet'е, а над гридом лежит прозрачная шапка высотой в ход шита. Пока
 * человек скроллит внутри этой шапки, «едет шит»; кончилась шапка — дальше
 * едет грид. Это одно и то же движение одного скролла, поэтому инерция
 * непрерывна сама собой: разгон в любую сторону перетекает из шита в список
 * и обратно ровно так же, как если бы палец не отрывался.
 *
 * Раньше здесь было наоборот — шит перехватывал движение своим `Gesture.Pan`
 * и держал список в нуле через `scrollTo`. Палец при этом вёл шит идеально,
 * но инерция обрывалась на стыке: передавать скорость от жеста нативному
 * скроллу нечем.
 *
 * Отдельным жестом остаётся ровно одно — смахнуть шит вниз, когда список
 * уже в нуле. Он не соревнуется со скроллом: активируется только при
 * `scrollOffset <= 0` и движении вниз.
 *
 * Закрытие всегда идёт через `requestClose()`: шит сначала уезжает вниз
 * целиком и только потом, если файлы были выбраны, спрашивает про сброс.
 * «Отмена» возвращает его на то же место — список всё это время остаётся
 * смонтированным, поэтому и позиция скролла, и положение шита те же.
 */
export function MediaPickerSheet({ visible, onDismiss, draft, onTyping, onSend }: MediaPickerSheetProps) {
  countRender('MediaPickerSheet');

  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const collapsedHeight = screenHeight * COLLAPSED_RATIO;
  /** Пустое место над свёрнутым шитом — оно же прозрачная шапка списка. */
  const headerHeight = screenHeight - collapsedHeight;
  /** Ход шита: от свёрнутого положения до верхней безопасной зоны. */
  const travel = headerHeight - insets.top;
  const dismissDistance = collapsedHeight * DISMISS_RATIO;

  const selectedCount = useSelectionCount();
  const hasMedia = selectedCount > 0;
  const hasMediaShared = useSharedValue(hasMedia);

  useEffect(() => {
    hasMediaShared.value = hasMedia;
  }, [hasMedia, hasMediaShared]);

  const [mounted, setMounted] = useState(visible);
  /** Грид начинает работать только после анимации открытия — см. комментарий у `MediaGrid.enabled`. */
  const [ready, setReady] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);

  /** Насколько шит утащен вниз относительно рабочего положения: 0 — на месте, screenHeight — за краем. */
  const dismissY = useSharedValue(screenHeight);
  const panStartY = useSharedValue(0);
  const canDismiss = useSharedValue(false);

  const listRef = useAnimatedRef<FlatList<MediaLibraryItem>>();
  const scrollOffset = useScrollOffset(listRef);

  const finishClose = useCallback(() => {
    setMounted(false);
    setReady(false);
    onDismiss();
  }, [onDismiss]);

  /**
   * Уехать вниз и только потом размонтироваться. Разбор шита стоит заметного
   * времени (замер: ~200 мс кадров на разрушение окна `Modal` и списка), и
   * это время должно приходиться на уже пустой экран, а не на анимацию.
   */
  const closeAnimated = useCallback(() => {
    dismissY.value = withTiming(screenHeight, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [dismissY, finishClose, screenHeight]);

  const openSheet = useCallback(() => {
    dismissY.value = withSpring(0, OPEN_SPRING, (finished) => {
      if (finished) runOnJS(setReady)(true);
    });
  }, [dismissY]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dismissY.value = screenHeight;
      openSheet();
    } else if (mounted) {
      closeAnimated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * Единственный путь закрытия — и для жеста, и для тапа по фону, и для
   * системной «назад». Сначала шит уезжает, и только потом задаётся вопрос:
   * спрашивать поверх наполовину открытого шита не о чем.
   */
  const requestClose = useCallback(() => {
    dismissY.value = withTiming(screenHeight, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (!finished) return;

      if (!hasMediaShared.value) {
        runOnJS(finishClose)();
        return;
      }

      runOnJS(askToDiscard)();
    });

    function askToDiscard() {
      void confirm({
        title: 'Отменить выбор файлов?',
        message: 'Выбранные фото и видео не будут отправлены.',
        confirmLabel: 'Сбросить',
        cancelLabel: 'Отмена',
        destructive: true,
      }).then((discard) => {
        if (discard) {
          useMediaSelection.getState().clear();
          finishClose();
          return;
        }

        // Передумал — шит возвращается туда же, откуда его смахнули:
        // список всё это время оставался смонтированным.
        openSheet();
      });
    }
  }, [dismissY, finishClose, hasMediaShared, openSheet, screenHeight]);

  const submit = useCallback(() => {
    onSend();
    onDismiss();
  }, [onSend, onDismiss]);

  // Нативный жест самого списка: жест закрытия объявлен одновременным с ним,
  // и ссылка на него должна пережить рендер, иначе связка распадётся.
  const listGesture = useMemo(() => Gesture.Native(), []);

  const ListComponent = useMemo<MediaListComponent>(
    () =>
      function SheetMediaList(props: ComponentProps<MediaListComponent>) {
        return (
          <GestureDetector gesture={listGesture}>
            <Animated.FlatList
              {...props}
              ref={listRef}
              showsVerticalScrollIndicator={false}
              // Положение шита считается из этих событий, поэтому они нужны
              // каждый кадр, а не раз в 50 мс, как по умолчанию у FlatList.
              scrollEventThrottle={16}
            />
          </GestureDetector>
        );
      },
    [listGesture, listRef],
  );

  const dismissPan = Gesture.Pan()
    .withTestId(SHEET_PAN_TEST_ID)
    .activeOffsetY([-PAN_ACTIVATION_PX, PAN_ACTIVATION_PX])
    .simultaneousWithExternalGesture(listGesture)
    .onStart(() => {
      panStartY.value = dismissY.value;
      // Смахнуть можно только с самого верха списка: во всех остальных
      // положениях это обычный скролл, и мешать ему нечем.
      canDismiss.value = scrollOffset.value <= 0;
    })
    .onUpdate((event) => {
      if (!canDismiss.value) return;

      dismissY.value = Math.max(panStartY.value + event.translationY, 0);
    })
    .onEnd((event) => {
      if (!canDismiss.value) return;

      canDismiss.value = false;

      if (dismissY.value > dismissDistance || event.velocityY > FLING_VELOCITY) {
        runOnJS(requestClose)();
        return;
      }

      dismissY.value = withSpring(0, OPEN_SPRING);
    });

  /** Весь шит целиком: и панель, и список, и строка ввода уезжают вместе. */
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  /**
   * Панель (фон с закруглением и ручка) следует за скроллом: её верхний край
   * стоит там, где кончается прозрачная шапка списка.
   */
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(travel - scrollOffset.value, 0) }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [0, collapsedHeight], [1, 0], Extrapolation.CLAMP),
  }));

  const measureFooter = useCallback((event: LayoutChangeEvent) => {
    setFooterHeight(event.nativeEvent.layout.height);
  }, []);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      {/* Modal — отдельное нативное окно на Android, не потомок корневого
          GestureHandlerRootView из _layout.tsx: без своего жесты внутри шита
          не работают. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { backgroundColor: theme.overlay }, backdropStyle]}
          pointerEvents="none"
        />

        <Animated.View style={[styles.root, shiftStyle]}>
          {/* Панель под списком: она только фон, все касания идут списку. */}
          <Animated.View
            style={[
              styles.panel,
              { top: insets.top, backgroundColor: theme.background },
              panelStyle,
            ]}
            pointerEvents="none"
          >
            <View style={styles.handle}>
              <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
            </View>
          </Animated.View>

          <GestureDetector gesture={dismissPan}>
            <View style={[styles.listWindow, { top: insets.top }]}>
              <MediaGrid
                ListComponent={ListComponent}
                enabled={ready}
                headerHeight={travel + HANDLE_BLOCK_HEIGHT}
                header={
                  <>
                    {/* Прозрачная шапка это одновременно и ход шита, и место,
                        тап по которому закрывает: фона под списком не достать. */}
                    <Pressable
                      testID="media-picker-backdrop"
                      style={{ height: travel }}
                      onPress={requestClose}
                    />
                    {/* Место под ручку: иначе первая строка легла бы на неё. */}
                    <View style={{ height: HANDLE_BLOCK_HEIGHT }} />
                  </>
                }
                footer={<View style={{ height: footerHeight }} />}
              />
            </View>
          </GestureDetector>
        </Animated.View>

        {hasMedia ? (
          <Animated.View style={[styles.footer, shiftStyle]} onLayout={measureFooter}>
            <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })}>
              <View style={{ backgroundColor: theme.background }}>
                <MessageComposer
                  text={draft.text}
                  onChangeText={draft.setText}
                  onSend={submit}
                  onTyping={onTyping}
                  canSend
                />
              </View>
            </KeyboardAvoidingView>
          </Animated.View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
