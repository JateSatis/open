// Шит на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CLOSE_DURATION_MS, OPEN_SPRING, sheetGeometry } from './geometry';
import { SheetListContext, SheetMediaList, type SheetListContextValue } from './SheetList';
import { SheetShell } from './SheetShell';
import {
  closeMediaSheet,
  finishMediaSheetClose,
  getMediaSheetPhase,
  useMediaSheetPhase,
  type MediaSheetPhase,
} from './sheetStore';
import { styles } from './styles';
import { useDismissGesture } from './useDismissGesture';

import { ConfirmDialogSurface, confirm } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { MediaGrid } from '@/features/media';
import { prefetchGallery } from '@/features/media/galleryPrefetch';
import { countRender, perfMark } from '@/features/media/perf';
import { useHasSelection, useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';

export { SHEET_PAN_TEST_ID } from './useDismissGesture';
export {
  armMediaSheet,
  closeMediaSheet,
  openMediaSheet,
  releaseMediaSheetArm,
  resetMediaSheet,
} from './sheetStore';

/** За сколько dp до рабочего положения монтируется список — см. ниже. */
const LIST_MOUNT_DISTANCE = 2;

export type MediaPickerSheetProps = {
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

/**
 * Шит выбора медиа. Открывается и закрывается через `sheetStore`: касание
 * кнопки медиа его готовит, отпускание — показывает.
 *
 * Окно `Modal` существует только пока шит нужен. Всё, что живёт одно
 * открытие, — анимация, жест, смонтирован ли список, — лежит в `SheetWindow`
 * и рождается вместе с окном, так что сбрасывать между открытиями нечего.
 */
export function MediaPickerSheet(props: MediaPickerSheetProps) {
  const phase = useMediaSheetPhase();

  // Уход с экрана посреди открытого шита: окно уходит вместе с экраном, и
  // следующий экран должен застать шит закрытым.
  useEffect(() => () => finishMediaSheetClose(), []);

  // Начало галереи читается заранее, пока человек читает чат: к открытию
  // шита клетки уже известны. Без выданного разрешения не делает ничего.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(prefetchGallery);

    return () => task.cancel();
  }, []);

  if (phase === 'closed') return null;

  return <SheetWindow phase={phase} {...props} />;
}

type SheetWindowProps = MediaPickerSheetProps & { phase: Exclude<MediaSheetPhase, 'closed'> };

/**
 * Свой шит на `react-native-gesture-handler` + `react-native-reanimated`:
 * `@gorhom/bottom-sheet` не работает с Reanimated 4.
 *
 * **Движением владеет список, а не шит.** Над гридом лежит прозрачная шапка
 * высотой в ход шита: пока человек скроллит внутри неё, «едет шит», дальше
 * едет грид. Это одно движение одного скролла, поэтому инерция непрерывна.
 * Ниже свёрнутого положения шит тянет жест закрытия — см. `useDismissGesture`.
 *
 * Открытие устроено так, чтобы движение начиналось в первый же кадр окна:
 *
 * - окно создаётся, пока палец ещё на кнопке, и рисует только лёгкую
 *   оболочку — подложку, ручку и сетку скелета (`SheetShell`);
 * - пружина стартует, когда окно уже на экране и палец отпущен: раньше она
 *   проигрывалась бы вхолостую, за невидимым окном;
 * - тяжёлый список монтируется под готовой оболочкой, уже на ходу.
 */
function SheetWindow({ phase, draft, onTyping, onSend }: SheetWindowProps) {
  countRender('MediaPickerSheet');

  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { travel, collapsedHeight, listTop, listWindowHeight, dismissDistance, topBarHeight } =
    sheetGeometry(screenHeight, insets.top, PixelRatio.get());

  const hasMedia = useHasSelection();

  const [shown, setShown] = useState(false);
  const [listMounted, setListMounted] = useState(false);
  const [scrollAttached, setScrollAttached] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);

  /** Насколько шит утащен вниз относительно рабочего положения: 0 — на месте. */
  const dismissY = useSharedValue(screenHeight);
  const scrollOffset = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const animatedRef = useAnimatedRef<ScrollView>();
  const scrollGestureRef = useRef<ComponentType | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (phase !== 'open' || !shown || started.current) return;

    started.current = true;
    perfMark('шит: старт пружины');
    // Если шит подхватили пальцем на ходу, пружина прерывается — список
    // всё равно нужен.
    dismissY.value = withSpring(0, OPEN_SPRING, () => {
      runOnJS(setListMounted)(true);
    });
  }, [dismissY, phase, shown]);

  /**
   * Список со всеми его клетками монтируется, когда шит уже почти на месте.
   * Монтирование занимает UI-поток на кадр в 60–80 мс, и в начале пути оно
   * замораживало бы сам выезд; на последних двух dp заморозку не видно, а
   * хвост пружины ждать незачем.
   */
  useAnimatedReaction(
    () => dismissY.value <= LIST_MOUNT_DISTANCE,
    (near, wasNear) => {
      if (near && !wasNear) runOnJS(setListMounted)(true);
    },
  );

  /**
   * Уехать вниз и только потом разобрать окно: разбор стоит заметного
   * времени и должен приходиться на уже пустой экран.
   */
  useEffect(() => {
    if (phase !== 'closing') return;

    dismissY.value = withTiming(screenHeight, { duration: CLOSE_DURATION_MS }, (finished) => {
      if (finished) runOnJS(finishMediaSheetClose)();
    });
  }, [dismissY, phase, screenHeight]);

  /**
   * Единственный путь закрытия — и для жеста, и для тапа по фону, и для
   * «назад». С выбранными файлами шит замирает там, где его оставил палец, и
   * вопрос задаётся поверх него, в этом же окне.
   */
  const requestClose = useCallback(() => {
    if (useMediaSelection.getState().order.length === 0) {
      closeMediaSheet();
      return;
    }

    void confirm({
      title: 'Отменить выбор файлов?',
      message: 'Выбранные фото и видео не будут отправлены.',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
      destructive: true,
    }).then((discard) => {
      if (discard) {
        useMediaSelection.getState().clear();
        closeMediaSheet();
        return;
      }

      // Передумал — шит возвращается в рабочее положение, откуда бы его ни утащили.
      dismissY.value = withSpring(0, OPEN_SPRING);
    });
  }, [dismissY]);

  /** «Назад» отвечает на вопрос, если он задан, и только иначе закрывает шит. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;

    if (getMediaSheetPhase() === 'armed') {
      closeMediaSheet();
      return;
    }

    requestClose();
  }, [requestClose]);

  const submit = useCallback(() => {
    onSend();
    closeMediaSheet();
  }, [onSend]);

  const dismissPan = useDismissGesture({
    dismissY,
    scrollOffset,
    dismissing,
    scrollGestureRef,
    scrollAttached,
    dismissDistance,
    onRelease: requestClose,
  });

  const markScrollAttached = useCallback(() => setScrollAttached(true), []);

  const listContext = useMemo<SheetListContextValue>(
    () => ({
      travel,
      topBarHeight,
      animatedRef,
      gestureRef: scrollGestureRef,
      scrollOffset,
      dismissing,
      onScrollAttached: markScrollAttached,
    }),
    [animatedRef, dismissing, markScrollAttached, scrollOffset, topBarHeight, travel],
  );

  /** Весь шит целиком: и панель, и список, и строка ввода уезжают вместе. */
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [0, collapsedHeight], [1, 0], Extrapolation.CLAMP),
  }));

  const measureFooter = useCallback((event: LayoutChangeEvent) => {
    setFooterHeight(event.nativeEvent.layout.height);
  }, []);

  /**
   * Шапка и хвост списка мемоизированы: `FlashList` сравнивает их по ссылке,
   * и новый элемент на каждом рендере перерисовывал бы всё смонтированное окно.
   */
  const header = useMemo(
    () => (
      <>
        {/* Прозрачная шапка — это и ход шита, и место, тап по которому закрывает. */}
        <Pressable
          testID="media-picker-backdrop"
          style={{ height: travel }}
          onPress={requestClose}
        />
        {/* Верх шита с ручкой; фон под ним рисует подложка в содержимом списка. */}
        <View style={[styles.sheetTop, { height: topBarHeight }]}>
          <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
        </View>
      </>
    ),
    [requestClose, theme.border, topBarHeight, travel],
  );

  const footer = useMemo(() => <View style={{ height: footerHeight }} />, [footerHeight]);

  return (
    <Modal
      testID="media-picker-window"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleBack}
      onShow={() => {
        perfMark('Modal.onShow');
        setShown(true);
      }}
    >
      {/* Modal — отдельное нативное окно на Android, не потомок корневого
          GestureHandlerRootView: без своего жесты внутри шита не работают. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { backgroundColor: theme.overlay }, backdropStyle]}
          pointerEvents="none"
        />

        <Animated.View style={[styles.root, shiftStyle]}>
          <GestureDetector gesture={dismissPan}>
            <View style={[styles.listWindow, { top: listTop }]}>
              <SheetShell top={travel} height={collapsedHeight} topBarHeight={topBarHeight} />
              {listMounted ? (
                <SheetListContext.Provider value={listContext}>
                  <MediaGrid
                    ListComponent={SheetMediaList}
                    enabled={listMounted}
                    header={header}
                    footer={footer}
                    // Подложка тянется до конца содержимого, значит содержимое
                    // не должно быть короче окна — иначе под ним осталась бы
                    // полоса, сквозь которую видно чат.
                    minContentHeight={travel + listWindowHeight}
                  />
                </SheetListContext.Provider>
              ) : null}
            </View>
          </GestureDetector>
        </Animated.View>

        {hasMedia ? (
          <Animated.View style={[styles.footer, shiftStyle]} onLayout={measureFooter}>
            <KeyboardAvoidingView
              behavior={Platform.select({ ios: 'padding', default: undefined })}
            >
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

        {/* Вопрос про сброс выбора рисуется внутри уже открытого окна шита:
            второе нативное окно на Android рождается заметное время. */}
        <ConfirmDialogSurface />
      </GestureHandlerRootView>
    </Modal>
  );
}
