// Компонент завязан на низкоуровневый API Reanimated напрямую (без
// @gorhom/bottom-sheet, см. комментарий ниже по файлу): мутация `.value` у
// shared value — единственный штатный способ им пользоваться, а не
// нарушение чистоты, которое видит в этом React Compiler. Запуск анимации
// сразу при появлении шита в эффекте — тоже осознанное действие, а не
// побочный каскад рендеров.
/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect */
import { FlashList } from '@shopify/flash-list';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import {
  createNativeWrapper,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
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

import { shouldDismissSheet } from './shouldDismissSheet';
import { SHEET_TOP_HEIGHT, styles } from './styles';

import { ConfirmDialogSurface, confirm } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import { GridSkeleton, MediaGrid, type MediaListComponent } from '@/features/media';
import { countRender } from '@/features/media/perf';
import { useHasSelection, useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';

export type MediaPickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  draft: ComposerDraft;
  onTyping: () => void;
  onSend: () => void;
};

/**
 * Скролл списка, про который жест закрытия знает, что с ним не спорит.
 *
 * `createNativeWrapper` вешает на `ScrollView` нативный жест RNGH и отдаёт
 * наружу сам `ScrollView` с проставленным `handlerTag` — то есть одна и та же
 * ссылка годится и списку, который этим скроллом управляет, и
 * `simultaneousWithExternalGesture`, которому нужен тег обработчика.
 *
 * Почему не `GestureDetector` с `Gesture.Native()`: снаружи `FlashList` он
 * цепляется к вью-обёртке, а не к скроллу, и жест закрытия просто съедает
 * скролл — список не двигается вовсе. Вокруг самого `ScrollView` он добавляет
 * свою вью, и `FlashList`, который меряет положение содержимого относительно
 * своего контейнера, начинает считать его неверно: после резкого броска сетка
 * пропадала целиком на 1.79 с (замер по записи экрана). Этот же враппер
 * дерево вью не трогает.
 */
const GestureScrollView = createNativeWrapper<ScrollViewProps>(ScrollView, {
  disallowInterruption: false,
  shouldCancelWhenOutside: false,
});

/** Жест закрытия — снаружи нужен только тестам, поэтому лежит рядом с самим жестом. */
export const SHEET_PAN_TEST_ID = 'media-picker-pan';

/** Доля экрана, на которую шит открывается по кнопке медиа. */
const COLLAPSED_RATIO = 0.55;
const OPEN_SPRING = { damping: 32, stiffness: 300, mass: 0.9 };
const CLOSE_DURATION_MS = 220;
/** Утащили шит ниже этой доли свёрнутой высоты — отпускание закрывает его. */
const DISMISS_RATIO = 0.2;
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
 * Закрытие с выбранными файлами шит не выполняет, а сначала спрашивает: он
 * замирает там, где оказался, и вопрос появляется поверх него, не покидая
 * этого же нативного окна (`ConfirmDialogSurface`). Экран не пустует, а
 * «Отмена» возвращает ровно то, что было, — список всё это время остаётся
 * смонтированным.
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
  /** Высота окна списка — от верхней безопасной зоны до низа экрана. */
  const listWindowHeight = screenHeight - insets.top;

  const hasMedia = useHasSelection();

  const [mounted, setMounted] = useState(visible);
  /** Грид начинает работать только после анимации открытия — см. комментарий у `MediaGrid.enabled`. */
  const [ready, setReady] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);

  /** Насколько шит утащен вниз относительно рабочего положения: 0 — на месте, screenHeight — за краем. */
  const dismissY = useSharedValue(screenHeight);
  const panStartY = useSharedValue(0);
  const canDismiss = useSharedValue(false);

  /**
   * Позиция скролла нужна ровно одному месту — жесту закрытия, который
   * работает только из самого верха списка. Пишет её обычный обработчик
   * скролла на JS-потоке: `FlashList` и сам считает видимое окно в этом же
   * колбэке, так что отстать от него эта запись не может, а обогнать ей
   * незачем — читают её один раз, в начале жеста.
   */
  const scrollOffset = useSharedValue(0);

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
      // Шит закрывается, но не размонтируется — значения переживают закрытие.
      // Список при следующем открытии начинается сверху, и позиция скролла
      // обязана начинаться оттуда же: с чужими 450 от прошлого раза жест
      // закрытия считает, что список пролистан, и смахнуть шит нельзя.
      scrollOffset.value = 0;
      openSheet();
    } else if (mounted) {
      closeAnimated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * Единственный путь закрытия — и для жеста, и для тапа по фону, и для
   * системной «назад».
   *
   * Когда файлы выбраны, шит не двигается вообще: его положение — это то,
   * где его оставил палец, и вопрос задаётся поверх. Уезжать, а потом
   * спрашивать, значило бы держать человека полсекунды перед пустым экраном
   * и уносить с экрана то, о чём спрашивают.
   */
  const askToDiscard = useCallback(() => {
    void confirm({
      title: 'Отменить выбор файлов?',
      message: 'Выбранные фото и видео не будут отправлены.',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
      destructive: true,
    }).then((discard) => {
      if (discard) {
        useMediaSelection.getState().clear();
        closeAnimated();
        return;
      }

      // Передумал — шит возвращается в рабочее положение, откуда бы его ни
      // утащили. Если его не двигали, пружина просто никуда не идёт.
      openSheet();
    });
  }, [closeAnimated, openSheet]);

  const requestClose = useCallback(() => {
    if (useMediaSelection.getState().order.length > 0) {
      askToDiscard();
      return;
    }

    closeAnimated();
  }, [askToDiscard, closeAnimated]);

  /** «Назад» отвечает на вопрос, если он задан, и только иначе закрывает шит. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;

    requestClose();
  }, [requestClose]);

  const submit = useCallback(() => {
    onSend();
    onDismiss();
  }, [onSend, onDismiss]);

  /** Скролл списка: жест закрытия объявлен одновременным с ним по этой ссылке. */
  const scrollGestureRef = useRef<ComponentType | null>(null);

  const trackScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffset.value = event.nativeEvent.contentOffset.y;
    },
    [scrollOffset],
  );

  /**
   * Подложка шита: сплошной непрозрачный слой со скруглённым верхом, от
   * верхнего края шита и до конца содержимого списка.
   *
   * Живёт **внутри содержимого списка**, а не отдельным слоем поверх или
   * под ним. Это единственный способ, при котором она не может разъехаться
   * со скруглённым верхом и ручкой: её двигает тот же нативный скролл, что и
   * клетки, а не анимация, которая его догоняет. Раньше фон рисовали сами
   * строки грида — и там, где строка не успела смонтироваться, сквозь шит
   * было видно чат.
   */
  const scrollComponent = useMemo(
    () =>
      forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView({ children, ...rest }, ref) {
        return (
          <GestureScrollView
            {...rest}
            ref={(instance: ComponentType | null) => {
              // Скролл нужен двоим: самому списку, который им управляет, и
              // жесту закрытия, которому достаточно знать, с чем не спорить.
              scrollGestureRef.current = instance;

              // RNGH описывает свой враппер как `ComponentType`, хотя наружу
              // отдаёт сам `ScrollView` — со всеми его методами и с
              // проставленным `handlerTag`. Списку нужен именно он.
              const scrollView = instance as unknown as ScrollView | null;

              if (typeof ref === 'function') ref(scrollView);
              else if (ref) ref.current = scrollView;
            }}
          >
            <View
              style={[styles.surface, { top: travel, backgroundColor: theme.background }]}
              pointerEvents="none"
            >
              {/* Сетка скелета живёт в подложке, то есть в координатах
                  содержимого: её двигает тот же нативный скролл, что и клетки.
                  Смещение — высота полосы с ручкой, ниже неё начинается
                  первая строка. */}
              <GridSkeleton
                top={SHEET_TOP_HEIGHT}
                square={theme.backgroundElement}
                gap={theme.background}
              />
            </View>
            {children}
          </GestureScrollView>
        );
      }),
    [theme.background, theme.backgroundElement, travel],
  );

  const ListComponent = useMemo<MediaListComponent>(
    () =>
      function SheetMediaList(props: ComponentProps<MediaListComponent>) {
        return (
          <FlashList
            {...props}
            showsVerticalScrollIndicator={false}
            renderScrollComponent={scrollComponent}
            onScroll={trackScroll}
            scrollEventThrottle={16}
          />
        );
      },
    [scrollComponent, trackScroll],
  );

  const dismissPan = Gesture.Pan()
    .withTestId(SHEET_PAN_TEST_ID)
    .activeOffsetY([-PAN_ACTIVATION_PX, PAN_ACTIVATION_PX])
    // Жест не читает ссылку в рендере — он запоминает её и спрашивает уже в
    // момент касания, когда скролл давно смонтирован. Правило про рефы этого
    // различить не может.
    // eslint-disable-next-line react-hooks/refs
    .simultaneousWithExternalGesture(scrollGestureRef)
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

      if (shouldDismissSheet(dismissY.value, dismissDistance, event.velocityY)) {
        // Никакой анимации здесь нет намеренно: шит остаётся ровно там, где
        // его отпустили. Что с ним будет дальше — улетит вниз или вернётся —
        // решает ответ на вопрос, а если спрашивать не о чем, `requestClose`
        // сам доводит его вниз.
        runOnJS(requestClose)();
        return;
      }

      dismissY.value = withSpring(0, OPEN_SPRING);
    });

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
   * Шапка и хвост списка мемоизированы намеренно. `ListHeaderComponent` и
   * `ListFooterComponent` сравниваются по ссылке: новый элемент на каждом
   * рендере шита заставлял список перерисовывать всё смонтированное окно.
   */
  const header = useMemo(
    () => (
      <>
        {/* Прозрачная шапка — это одновременно и ход шита, и место, тап по
            которому закрывает: фона под списком не достать. */}
        <Pressable
          testID="media-picker-backdrop"
          style={{ height: travel }}
          onPress={requestClose}
        />
        {/* Верх шита с ручкой. Фон и скругление под ним рисует подложка —
            она в тех же координатах содержимого, поэтому шов между ними
            невозможен в принципе. */}
        <View style={styles.sheetTop}>
          <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
        </View>
      </>
    ),
    [requestClose, theme.border, travel],
  );

  const footer = useMemo(() => <View style={{ height: footerHeight }} />, [footerHeight]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleBack}>
      {/* Modal — отдельное нативное окно на Android, не потомок корневого
          GestureHandlerRootView из _layout.tsx: без своего жесты внутри шита
          не работают. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[styles.backdrop, { backgroundColor: theme.overlay }, backdropStyle]}
          pointerEvents="none"
        />

        <Animated.View style={[styles.root, shiftStyle]}>
          <GestureDetector gesture={dismissPan}>
            <View style={[styles.listWindow, { top: insets.top }]}>
              <MediaGrid
                ListComponent={ListComponent}
                enabled={ready}
                header={header}
                footer={footer}
                // Подложка тянется до конца содержимого, значит содержимое не
                // должно быть короче окна — иначе под ним осталась бы полоса,
                // сквозь которую видно чат.
                minContentHeight={travel + listWindowHeight}
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

        {/* Вопрос про сброс выбора рисуется здесь, внутри уже открытого окна
            шита: второе нативное окно Modal на Android рождается около 200 мс
            и съедает ровно те кадры, в которые шит должен отвечать на палец. */}
        <ConfirmDialogSurface />
      </GestureHandlerRootView>
    </Modal>
  );
}
