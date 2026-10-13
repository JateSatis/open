// Шит на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться, а не нарушение чистоты, которое видит в
// этом React Compiler.
/* eslint-disable react-hooks/immutability */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  InteractionManager,
  Keyboard,
  Modal,
  PixelRatio,
  Pressable,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
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

import { sheetGeometry } from './geometry';
import { GALLERY_ONLY, type SheetSection, type SheetSectionSlot } from './sections';
import { SheetList, SheetListContext, type SheetListContextValue } from './SheetList';
import { SheetShell } from './SheetShell';
import { SheetTop } from './SheetTop';
import { SheetTabs } from './SheetTabs';
import {
  closeMediaSheet,
  finishMediaSheetClose,
  getMediaSheetPhase,
  useMediaSheetPhase,
  type AvatarSheetOwner,
  type MediaSheetOwner,
  type MediaSheetPhase,
} from './sheetStore';
import { styles } from './styles';

import { CLOSE_DURATION_MS, OPEN_SPRING, useDismissGesture } from '@/components/ScrollSheet';

import { ConfirmDialogSurface, confirm } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import {
  claimKeyboardForSheet,
  setSheetKeyboardWindowOpen,
  useOwnKeyboardHeight,
} from '@/features/chats/composerKeyboard';
import { MessageComposer } from '@/features/chats/MessageComposer';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { GridPick, MediaLibraryItem } from '@/features/media';
import { prefetchGallery } from '@/features/media/galleryPrefetch';
import { handlePreviewBack, MediaPreview, resetMediaPreview } from '@/features/media/MediaPreview';
import { countRender, perfMark } from '@/features/media/perf';
import { isolatePhotoEdits } from '@/features/media/photoEdits/editsStore';
import { useHasSelection, useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';

/** Жест закрытия — снаружи нужен только тестам. */
export const SHEET_PAN_TEST_ID = 'media-picker-pan';
export {
  armMediaSheet,
  closeMediaSheet,
  openMediaSheet,
  releaseMediaSheetArm,
  resetMediaSheet,
  type AvatarSheetOwner,
  type MediaSheetOwner,
} from './sheetStore';
export { GALLERY_ONLY, gallerySection, type SheetSection, type SheetSectionSlot } from './sections';

/** За сколько dp до рабочего положения монтируется список — см. ниже. */
const LIST_MOUNT_DISTANCE = 2;

/** Строка ввода шита: подпись к выбранным файлам и отправка. */
type SheetComposerProps = {
  draft: ComposerDraft;
  /** Плашка над полем шита: ответ или правка — альбом бывает и тем и другим. */
  plate?: ReactNode;
  /** Идёт правка: «О» шита сохраняет её, а не отправляет новое сообщение. */
  editing?: boolean;
  /** Подсказка в поле шита — как у поля, которое его открыло. */
  placeholder?: string;
  /** Имя чата — в шапке предпросмотра файлов. */
  title?: string;
  onTyping: () => void;
  onSend: () => void;
};

export type MediaPickerSheetProps = SheetComposerProps & {
  /** Чьё поле открывает этот экземпляр: показывается он только для своего хозяина. */
  owner?: 'chat' | 'comments';
  /**
   * Разделы шита — вкладки внизу. Набор задаёт хозяин по виду чата; при одном
   * разделе вкладок нет. По умолчанию — только галерея.
   */
  sections?: SheetSection[];
};

export type MediaPickSheetProps = Required<GridPick>;

export type AvatarPickSheetProps = {
  /** Чей это шит: открывается `openMediaSheet(owner)`. */
  owner: AvatarSheetOwner;
  /** «Готово» в редакторе: фото, правки которого ещё доступны, — шит закроется сам. */
  onPick: (asset: MediaLibraryItem) => void;
};

/** Аватарка пока только из фото; видео притушены — по `accepts` позже включатся видео-аватарки. */
const acceptsPhoto = (asset: MediaLibraryItem) => asset.kind === 'photo';
const AVATAR_PICK: GridPick = { accepts: acceptsPhoto };
const AVATAR_TITLE = 'Выберите фото';

/**
 * Шит выбора медиа. Открывается и закрывается через `sheetStore`: касание
 * кнопки медиа его готовит, отпускание — показывает.
 *
 * Окно `Modal` существует только пока шит нужен. Всё, что живёт одно
 * открытие, — анимация, жест, смонтирован ли список, — лежит в `SheetWindow`
 * и рождается вместе с окном, так что сбрасывать между открытиями нечего.
 */
export function MediaPickerSheet({
  owner = 'chat',
  sections = GALLERY_ONLY,
  ...composer
}: MediaPickerSheetProps) {
  const phase = useSheetPhase(owner);

  if (phase === 'closed') return null;

  return <SheetWindow phase={phase} composer={composer} sections={sections} />;
}

/**
 * Тот же шит для выбора одного файла: без строки ввода, тап по подходящей
 * клетке отдаёт файл в `onPick` и закрывает шит. Открывается
 * `openMediaSheet('pick')`. Общий выбор файлов чата он не трогает.
 *
 * `accepts` решает, какие клетки можно взять: остальные видны притушенными.
 */
export function MediaPickSheet({ accepts, onPick }: MediaPickSheetProps) {
  const phase = useSheetPhase('pick');
  const pick = useMemo<GridPick>(
    () => ({
      accepts,
      onPick: (asset) => {
        onPick(asset);
        closeMediaSheet();
      },
    }),
    [accepts, onPick],
  );

  if (phase === 'closed') return null;

  return <SheetWindow phase={phase} pick={pick} sections={GALLERY_ONLY} />;
}

/**
 * Шит аватарки: галерея без кружков, с заголовком; тап по фото раскрывает
 * его в редактор, «Готово» отдаёт фото в `onPick` и закрывает шит. Правки
 * здесь — свои, шит чата их не видит, и живут они, только пока открыто окно.
 * Открывается `openMediaSheet(owner)`. Хозяевам — `MediaAvatarSheet`: он
 * сразу превращает фото в файл аватарки.
 */
export function AvatarPickSheet({ owner, onPick }: AvatarPickSheetProps) {
  const phase = useSheetPhase(owner);
  const avatar = useMemo(
    () => ({
      onDone: (asset: MediaLibraryItem) => {
        onPick(asset);
        closeMediaSheet();
      },
    }),
    [onPick],
  );

  if (phase === 'closed') return null;

  return <SheetWindow phase={phase} avatar={avatar} sections={GALLERY_ONLY} />;
}

/** Жизнь окна шита вокруг экземпляра хозяина `owner`. */
function useSheetPhase(owner: MediaSheetOwner): MediaSheetPhase {
  const phase = useMediaSheetPhase(owner);

  // Уход с экрана посреди открытого шита: окно уходит вместе с экраном, и
  // следующий экран должен застать шит закрытым.
  useEffect(() => () => finishMediaSheetClose(owner), [owner]);

  // Пока окно шита существует, клавиатурой может владеть его поле, и чат
  // под шитом на неё не реагирует.
  useEffect(() => setSheetKeyboardWindowOpen(phase !== 'closed'), [phase]);

  // Поле чата теряет фокус, как только шит начинает открываться. Клавиатуру
  // система прячет и сама, вместе с появлением окна, но фокус оставляет — и
  // после закрытия шита клавиатура выехала бы снова. Поле шита в этот момент
  // ещё не в фокусе: его фокусирует только касание.
  useEffect(() => {
    if (phase === 'armed' || phase === 'open') Keyboard.dismiss();
  }, [phase]);

  // Начало галереи читается заранее, пока человек читает чат: к открытию
  // шита клетки уже известны. Без выданного разрешения не делает ничего.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(prefetchGallery);

    return () => task.cancel();
  }, []);

  return phase;
}

type SheetWindowProps = {
  phase: Exclude<MediaSheetPhase, 'closed'>;
  /** Шит отбора файлов в сообщение: со строкой ввода. */
  composer?: SheetComposerProps;
  /** Шит выбора одного файла: без строки ввода. */
  pick?: GridPick;
  /** Шит аватарки: заголовок, фото раскрывается в редактор. */
  avatar?: { onDone: (asset: MediaLibraryItem) => void };
  sections: SheetSection[];
};

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
/** Строка шита видна только с выбранными файлами — сохранять правку есть что. */
const SHEET_EDIT = {
  canSave: true,
  textLocked: false,
  attachDisabled: true,
  recordDisabled: true,
} as const;

function SheetWindow({ phase, composer, pick: pickProp, avatar, sections }: SheetWindowProps) {
  // `composer` — новый объект на каждый рендер экрана; зависимостям нужен только факт.
  const hasComposer = composer !== undefined;
  const pick = avatar ? AVATAR_PICK : pickProp;
  const title = avatar ? AVATAR_TITLE : undefined;
  countRender('MediaPickerSheet');

  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { travel, collapsedHeight, listTop, listWindowHeight, dismissDistance, topBarHeight } =
    sheetGeometry(screenHeight, insets.top, PixelRatio.get(), title !== undefined);

  const hasMedia = useHasSelection();
  const keyboardHeight = useOwnKeyboardHeight('sheet');

  const [shown, setShown] = useState(false);
  const [listMounted, setListMounted] = useState(false);
  const [scrollAttached, setScrollAttached] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  // Окно рождается на каждое открытие — и открывается всегда на первом разделе.
  const [activeKey, setActiveKey] = useState(sections[0]?.key);
  const active = sections.find((section) => section.key === activeKey) ?? sections[0];
  const showTabs = sections.length > 1;

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

    // Как бы шит ни закрывался — отправкой, тапом по фону или жестом, —
    // клавиатура его поля уезжает вместе с ним.
    void KeyboardController.dismiss();
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
    // Вопрос про сброс не должен оказаться под клавиатурой.
    void KeyboardController.dismiss();

    // В выборе одного файла сбрасывать нечего: общий выбор чата не его.
    if (!hasComposer || useMediaSelection.getState().order.length === 0) {
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
  }, [dismissY, hasComposer]);

  /**
   * «Назад» отвечает на вопрос, если он задан; открытый предпросмотр
   * закрывается сам, шит под ним остаётся; и только иначе закрывается шит.
   */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;

    if (handlePreviewBack()) return;

    if (getMediaSheetPhase() === 'armed') {
      closeMediaSheet();
      return;
    }

    requestClose();
  }, [requestClose]);

  const onSend = composer?.onSend;
  const submit = useCallback(() => {
    onSend?.();
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
    testId: SHEET_PAN_TEST_ID,
  });

  const markScrollAttached = useCallback(() => setScrollAttached(true), []);

  // Предпросмотр живёт в окне шита и уходит вместе с ним.
  useEffect(() => resetMediaPreview, []);

  // Правки аватарки — свой сеанс на время окна. До отрисовки: плитки с
  // правками чата не должны мелькнуть в первом кадре.
  const isolated = avatar !== undefined;

  useLayoutEffect(() => (isolated ? isolatePhotoEdits() : undefined), [isolated]);

  /**
   * Другой раздел — другой список: прежний скролл уходит, новый начинается с
   * верха шита в свёрнутом положении. Жест закрытия ждёт, пока новый список
   * отдаст свой скролл, и пересобирается на него.
   */
  const selectSection = useCallback(
    (key: string) => {
      if (key === activeKey) return;

      setScrollAttached(false);
      scrollOffset.value = 0;
      setActiveKey(key);
    },
    [activeKey, scrollOffset],
  );

  const listContext = useMemo<SheetListContextValue>(
    () => ({
      travel,
      topBarHeight,
      animatedRef,
      gestureRef: scrollGestureRef,
      scrollOffset,
      dismissing,
      onScrollAttached: markScrollAttached,
      skeleton: active?.skeleton ?? false,
    }),
    [active, animatedRef, dismissing, markScrollAttached, scrollOffset, topBarHeight, travel],
  );

  /** Весь шит целиком: и панель, и список, и строка ввода уезжают вместе. */
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  /**
   * Строка ввода стоит ровно над клавиатурой своего поля, поверх грида, и
   * уезжает вниз вместе с шитом. Высота клавиатуры меряется от низа экрана и
   * уже покрывает полосу системной навигации, под которую у строки свой
   * отступ, — его клавиатура и закрывает.
   */
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value - Math.max(keyboardHeight.value - insets.bottom, 0) }],
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
        <SheetTop height={topBarHeight} title={title} />
      </>
    ),
    [requestClose, title, topBarHeight, travel],
  );

  const footer = useMemo(() => <View style={{ height: footerHeight }} />, [footerHeight]);

  const slot = useMemo<SheetSectionSlot>(
    () => ({
      List: SheetList,
      header,
      footer,
      pick,
      // Подложка тянется до конца содержимого, значит содержимое не должно
      // быть короче окна — иначе под ним осталась бы полоса, сквозь которую
      // видно чат.
      minContentHeight: travel + listWindowHeight,
    }),
    [footer, header, listWindowHeight, pick, travel],
  );

  const showComposer = composer !== undefined && hasMedia;

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
              <SheetShell
                top={travel}
                height={collapsedHeight}
                topBarHeight={topBarHeight}
                title={title}
              />
              {listMounted && active ? (
                <SheetListContext.Provider value={listContext}>
                  <Fragment key={active.key}>{active.render(slot)}</Fragment>
                </SheetListContext.Provider>
              ) : null}
            </View>
          </GestureDetector>
        </Animated.View>

        {showComposer || showTabs ? (
          <Animated.View
            testID="media-picker-footer"
            style={[
              styles.footer,
              { backgroundColor: theme.background, paddingBottom: insets.bottom },
              footerStyle,
            ]}
            onLayout={measureFooter}
          >
            {composer && showComposer ? (
              <MessageComposer
                text={composer.draft.text}
                onChangeText={composer.draft.setText}
                onSend={submit}
                onTyping={composer.onTyping}
                onFieldActivate={claimKeyboardForSheet}
                plate={composer.plate}
                edit={composer.editing ? SHEET_EDIT : undefined}
                placeholder={composer.placeholder}
                canSend
              />
            ) : null}
            {showTabs && active ? (
              <SheetTabs sections={sections} activeKey={active.key} onSelect={selectSection} />
            ) : null}
          </Animated.View>
        ) : null}

        {/* Предпросмотр файлов — в этом же окне, поверх сетки: второе
            нативное окно на Android рождается заметное время. */}
        {composer ? (
          <MediaPreview
            title={composer.title ?? ''}
            text={composer.draft.text}
            onChangeText={composer.draft.setText}
            placeholder={composer.placeholder ?? 'Подпись'}
            editing={composer.editing ?? false}
            onSend={submit}
            gridViewport={{ top: listTop + topBarHeight, bottom: screenHeight - footerHeight }}
          />
        ) : null}
        {avatar ? (
          <MediaPreview
            mode="avatar"
            onDone={avatar.onDone}
            gridViewport={{ top: listTop + topBarHeight, bottom: screenHeight }}
          />
        ) : null}

        {/* Вопрос про сброс выбора рисуется внутри уже открытого окна шита:
            второе нативное окно на Android рождается заметное время. */}
        <ConfirmDialogSurface />
      </GestureHandlerRootView>
    </Modal>
  );
}
