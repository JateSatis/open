// Компонент завязан на низкоуровневый API Reanimated напрямую (без
// @gorhom/bottom-sheet, см. комментарий ниже по файлу): мутация `.value` у
// shared value — единственный штатный способ им пользоваться, а не
// нарушение чистоты, которое видит в этом React Compiler. Запуск анимации
// сразу при появлении шита в эффекте — тоже осознанное действие, а не
// побочный каскад рендеров. По той же причине отключён `react-hooks/refs`:
// анимированный ref списка передаётся в `scrollTo` внутри колбэка жеста —
// это worklet на UI-потоке, а не чтение ref во время рендера, которое видит
// в нём правило.
/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/refs */
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
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { confirm } from '@/components/ConfirmDialog';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { MediaGrid, type MediaListComponent, type MediaLibraryItem } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

export type MediaPickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

/** Жест шита — снаружи он нужен только тестам, поэтому лежит рядом с самим жестом. */
export const SHEET_PAN_TEST_ID = 'media-picker-pan';

const SPRING_CONFIG = { damping: 32, stiffness: 300, mass: 0.9 };
const CLOSE_DURATION_MS = 200;
/** Доля экрана, на которую шит открывается по кнопке медиа. */
const COLLAPSED_RATIO = 0.55;
/** Сколько нужно утащить шит ниже свёрнутого положения, чтобы отпускание закрыло его. */
const CLOSE_RATIO = 0.25;
const FLING_VELOCITY = 800;
/**
 * Инерция после отпускания: шит остаётся там, где его отпустили, и лишь
 * немного докатывается по скорости. Ближе к единице — дольше едет.
 */
const DECELERATION = 0.985;
/** Жест считается вертикальным после этого сдвига — иначе тап по кружку выбора не доживал бы до Pressable. */
const PAN_ACTIVATION_PX = 8;
/** Меньше пикселя до края — считаем, что шит в него упёрся. */
const EDGE_EPSILON = 1;

/**
 * Свой шит на голых `react-native-gesture-handler` + `react-native-reanimated`
 * вместо `@gorhom/bottom-sheet`: библиотека не работает с Reanimated 4 —
 * `present()` отрабатывает без ошибок, но шит физически не появляется.
 * Перепроверено на последней опубликованной версии (5.2.14, она же последняя
 * на момент этой задачи) — поведение прежнее, обходного пути в апстриме нет.
 * Даунгрейд Reanimated до 3.x тоже не вариант — та ветка не собирается под
 * текущий RN (несовпадение с Hermes prefab при сборке нативного модуля).
 *
 * Положение шита — один shared value `sheetY` (сдвиг вниз от полностью
 * раскрытого состояния), который двигает **один** жест на всём шите, а грид
 * внутри — обычный виртуализированный список со своим нативным скроллом.
 * Связка между ними сделана руками:
 *
 * - жест объявлен одновременным с `Gesture.Native()` грида, поэтому палец не
 *   выбирает между «двигать шит» и «скроллить список» — активны оба;
 * - кто из двоих реально двигается, решает `onUpdate`: пока шит не упёрся в
 *   верх экрана, движение достаётся шиту, а список принудительно держится в
 *   нуле через `scrollTo`; как только шит наверху — движение вверх уходит
 *   списку, а движение вниз возвращается шиту ровно в тот момент, когда
 *   список дошёл до начала. Всё это внутри одного непрерывного жеста;
 * - отпущенный шит не притягивается к снап-поинтам: `withDecay` докатывает
 *   его по скорости и оставляет там, где остановился. Единственные жёсткие
 *   границы — верх экрана и свёрнутое положение.
 *
 * Закрывает шит только жест, начатый с уже свёрнутого положения: тот же
 * жест, что опустил шит от верха экрана, упирается в «половину». Закрытие —
 * всегда через `requestClose()`, общий для жеста, тапа по фону и системной
 * кнопки «назад», поэтому подтверждение сброса выбранных файлов спрашивается
 * одинаково во всех трёх случаях.
 */
export function MediaPickerSheet({ visible, onDismiss, draft, onTyping, onSend }: MediaPickerSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const expandedHeight = screenHeight - insets.top;
  const collapsedHeight = screenHeight * COLLAPSED_RATIO;
  // `sheetY` = насколько шит сдвинут вниз от полностью раскрытого состояния.
  const collapsedY = expandedHeight - collapsedHeight;
  const closedY = expandedHeight;
  const closeDistance = collapsedHeight * CLOSE_RATIO;

  const hasMedia = draft.media.length > 0;
  const hasMediaShared = useSharedValue(hasMedia);

  useEffect(() => {
    hasMediaShared.value = hasMedia;
  }, [hasMedia, hasMediaShared]);

  const [mounted, setMounted] = useState(visible);
  const [footerHeight, setFooterHeight] = useState(0);

  const sheetY = useSharedValue(closedY);
  const lastTranslationY = useSharedValue(0);
  /** Жест начался со свёрнутого шита — значит этим же жестом его можно закрыть. */
  const canClose = useSharedValue(false);
  /** Текущий жест двигает шит, а не скроллит список. */
  const dragsSheet = useSharedValue(false);

  const listRef = useAnimatedRef<FlatList<MediaLibraryItem>>();
  const scrollOffset = useScrollOffset(listRef);

  const finishClose = useCallback(() => {
    setMounted(false);
    onDismiss();
  }, [onDismiss]);

  const closeAnimated = useCallback(() => {
    sheetY.value = withTiming(closedY, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [closedY, finishClose, sheetY]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      sheetY.value = closedY;
      sheetY.value = withSpring(collapsedY, SPRING_CONFIG);
    } else if (mounted) {
      closeAnimated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const requestClose = useCallback(() => {
    if (!hasMedia) {
      closeAnimated();
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
      closeAnimated();
    });
  }, [hasMedia, draft, closeAnimated]);

  const submit = useCallback(() => {
    onSend();
    onDismiss();
  }, [onSend, onDismiss]);

  // Нативный жест самого списка: пан шита объявлен одновременным с ним, и
  // ссылка на него должна пережить рендер, иначе связка распадётся.
  const listGesture = useMemo(() => Gesture.Native(), []);

  const ListComponent = useMemo<MediaListComponent>(
    () =>
      function SheetMediaList(props: ComponentProps<MediaListComponent>) {
        return (
          <GestureDetector gesture={listGesture}>
            <Animated.FlatList {...props} ref={listRef} showsVerticalScrollIndicator={false} />
          </GestureDetector>
        );
      },
    [listGesture, listRef],
  );

  const sheetPan = Gesture.Pan()
    .withTestId(SHEET_PAN_TEST_ID)
    .activeOffsetY([-PAN_ACTIVATION_PX, PAN_ACTIVATION_PX])
    .simultaneousWithExternalGesture(listGesture)
    .onStart((event) => {
      lastTranslationY.value = event.translationY;
      dragsSheet.value = false;
      canClose.value = sheetY.value >= collapsedY - EDGE_EPSILON;
    })
    .onUpdate((event) => {
      const dy = event.translationY - lastTranslationY.value;

      lastTranslationY.value = event.translationY;

      const atTopOfScreen = sheetY.value <= EDGE_EPSILON;
      const listAtStart = dy > 0 && scrollOffset.value <= 0;

      if (atTopOfScreen && !listAtStart) {
        // Шит наверху, палец идёт вверх (или список ещё не домотан до
        // начала) — движение целиком достаётся списку.
        dragsSheet.value = false;
        return;
      }

      const maxY = canClose.value ? closedY : collapsedY;

      sheetY.value = Math.min(Math.max(sheetY.value + dy, 0), maxY);
      // Пока двигается шит, список стоит в начале: иначе одно движение
      // пальца двигало бы и шит, и его содержимое.
      scrollTo(listRef, 0, 0, false);
      dragsSheet.value = true;
    })
    .onEnd((event) => {
      if (!dragsSheet.value) return;

      dragsSheet.value = false;

      const draggedFarEnough = sheetY.value > collapsedY + closeDistance;
      const flungDown = event.velocityY > FLING_VELOCITY && sheetY.value > collapsedY;

      if (canClose.value && (draggedFarEnough || flungDown)) {
        // Подтверждение сброса спрашивается уже на свёрнутом шите — решение
        // за `requestClose`, жест только возвращает шит на место.
        if (hasMediaShared.value) sheetY.value = withSpring(collapsedY, SPRING_CONFIG);

        runOnJS(requestClose)();
        return;
      }

      if (sheetY.value >= collapsedY) {
        sheetY.value = withSpring(collapsedY, SPRING_CONFIG);
        return;
      }

      sheetY.value = withDecay({
        velocity: event.velocityY,
        deceleration: DECELERATION,
        clamp: [0, collapsedY],
      });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetY.value, [closedY, collapsedY], [0, 1], Extrapolation.CLAMP),
  }));
  // Строка ввода стоит на месте, пока шит ходит между «половиной» и верхом
  // экрана, и уезжает вниз только когда шит уходит за нижний край.
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(sheetY.value - collapsedY, 0) }],
  }));

  // Список живёт в шите на всю высоту экрана, а видно от него только то, что
  // выше нижнего края экрана. Поэтому под последней строкой нужен хвост
  // ровно в ту высоту, на которую шит опущен, плюс высота строки ввода —
  // иначе конец галереи со свёрнутого шита не долистать.
  const tailSpacerStyle = useAnimatedStyle(() => ({ height: sheetY.value + footerHeight }));

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
        <Animated.View style={[styles.backdrop, { backgroundColor: theme.overlay }, backdropStyle]}>
          <Pressable
            testID="media-picker-backdrop"
            style={styles.backdropTouchable}
            onPress={requestClose}
          />
        </Animated.View>

        <GestureDetector gesture={sheetPan}>
          <Animated.View
            style={[styles.sheet, { top: insets.top, backgroundColor: theme.background }, sheetStyle]}
          >
            <View style={styles.handle}>
              <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
            </View>

            <View style={styles.content}>
              <MediaGrid
                selected={draft.media}
                onToggle={draft.toggleMedia}
                ListComponent={ListComponent}
                footerSpace={<Animated.View style={tailSpacerStyle} />}
              />
            </View>
          </Animated.View>
        </GestureDetector>

        {hasMedia ? (
          <Animated.View style={[styles.footer, footerStyle]} onLayout={measureFooter}>
            <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })}>
              <View style={{ backgroundColor: theme.background }}>
                <MessageComposer
                  text={draft.text}
                  onChangeText={draft.setText}
                  media={draft.media}
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
