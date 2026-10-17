import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaViewerPage, viewerBase } from './MediaViewerPage';
import { styles } from './styles';
import { useViewerFlight } from './useViewerFlight';
import { useViewerGestures } from './useViewerGestures';

import { Text } from '@/components/Text';
import {
  setHiddenTile,
  useTileViewport,
  type TileRect,
  type TileRegistry,
} from '@/features/media/tileRegistry';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';
import type { MediaViewerItem } from './types';

export type { MediaViewerItem };

export type MediaViewerProps = {
  visible: boolean;
  /**
   * Палец лежит на плитке, тапа ещё не было: окно и медиа в нём уже
   * готовятся, но стоят в плитке. Рождение нативного окна и первая отрисовка
   * стоят под сотню миллисекунд — они уходят на то время, пока палец ещё
   * держит плитку, как у шита медиа. Отпустили — перелёт начинается сразу.
   */
  armed?: boolean;
  items: MediaViewerItem[];
  initialIndex: number;
  onClose: () => void;
  /** Листнули на другую страницу — например, чтобы подгрузить дальше. */
  onIndexChange?: (index: number) => void;
  /** Где на экране плитка, по которой тапнули: медиа вырастает из неё. */
  origin?: TileRect | null;
  /** Плитки медиа по id: закрытый просмотр уходит в плитку текущего файла. */
  tiles?: TileRegistry | null;
};

/**
 * Полноэкранный просмотр вложений одного сообщения или всех медиа чата. Видео проигрывается
 * само и останавливается по тапу — сложный плеер (перемотка, громкость)
 * сюда сознательно не входит, это следующая задача.
 *
 * Окно рождается заново на каждое открытие: листание, увеличение и уход
 * начинаются с нуля. Медиа вырастает из плитки и уходит в неё — см.
 * `useViewerFlight`.
 */
export function MediaViewer({ visible, ...props }: MediaViewerProps) {
  if (!visible) return null;

  return <ViewerWindow {...props} />;
}

/**
 * Сколько страниц по обе стороны от активной держать готовыми. Остальные —
 * пустые места: листают и сотни медиа чата, а плеер и картинка на каждую
 * сразу заморозили бы открытие.
 */
const PAGE_WINDOW = 1;

type ViewerProps = Omit<MediaViewerProps, 'visible'>;

/** Окно просмотра: рождается на каждое открытие. */
function ViewerWindow({ onClose, ...props }: ViewerProps) {
  const backRef = useRef<() => void>(onClose);
  // Не состояние: показ окна сразу трогает перелёт, без лишней перерисовки.
  const [shown] = useState(createWindowSignal);
  // Взведённое окно рождается пустым — так оно появляется быстрее всего, — а
  // медиа в нём монтируется, как только окно на экране, ещё под пальцем.
  const [windowUp, setWindowUp] = useState(false);

  return (
    <Modal
      testID="media-viewer-window"
      visible
      transparent
      animationType="none"
      onRequestClose={() => backRef.current()}
      onShow={() => {
        shown.fire();
        setWindowUp(true);
      }}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Своё окно на Android — свой корень жестов, как у шитов. */}
      <GestureHandlerRootView style={styles.container}>
        {props.armed && !windowUp ? null : (
          <ViewerContent {...props} onClose={onClose} windowShown={shown} backRef={backRef} />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Показано ли окно, и кого позвать, когда покажется. */
type WindowShown = {
  isShown: () => boolean;
  setListener: (listener: () => void) => void;
  fire: () => void;
};

function createWindowSignal(): WindowShown {
  let shown = false;
  let listener = () => undefined as void;

  return {
    isShown: () => shown,
    setListener: (next) => {
      listener = next;
    },
    fire: () => {
      shown = true;
      listener();
    },
  };
}

type ViewerContentProps = ViewerProps & {
  windowShown: WindowShown;
  /** «Назад» окна: просмотр уходит так же, как по крестику. */
  backRef: { current: () => void };
};

function ViewerContent({
  items,
  initialIndex,
  onClose,
  onIndexChange,
  origin = null,
  tiles = null,
  armed = false,
  windowShown,
  backRef,
}: ViewerContentProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const measureViewport = useTileViewport();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // Пауза по тапу — у активной страницы: тап ловит общий жест просмотрщика.
  const togglesRef = useRef(new Map<number, () => void>());

  const active = items[activeIndex];
  const base = useMemo(
    () => (active ? viewerBase(active, width, height) : { x: 0, y: 0, width, height }),
    [active, height, width],
  );
  const sourceTile = useMemo(
    () => (origin ? { width: origin.width, height: origin.height } : null),
    [origin],
  );
  const initial = items[initialIndex];
  const hasThumb = Boolean(sourceTile && initial?.thumbUrl);

  const onPageChange = useCallback(
    (index: number) => {
      setActiveIndex(index);
      onIndexChange?.(index);
    },
    [onIndexChange],
  );

  const onTap = useCallback(() => togglesRef.current.get(activeIndex)?.(), [activeIndex]);

  // Жест решает только «уходить», а куда — перелёт: ему нужен файл и его
  // рамка в момент ухода.
  const leaveRef = useRef<(direction: -1 | 0 | 1) => void>(() => undefined);
  const onDismiss = useCallback((direction: -1 | 1) => leaveRef.current(direction), []);

  const { gesture, pagerStyle, activeStyle, zoom } = useViewerGestures({
    count: items.length,
    initialIndex,
    width,
    height,
    contentWidth: base.width,
    contentHeight: base.height,
    onPageChange,
    onTap,
    onDismiss,
  });

  const { motion, leaving, settled, launch, leave, backgroundStyle, chromeStyle, fallbackMs } =
    useViewerFlight({
      initialOrigin: origin,
      tiles,
      measureViewport,
      width,
      height,
      zoom,
      onClosed: onClose,
    });

  const activeId = active?.id;

  // Пролистали — пустой стоит плитка того файла, что сейчас открыт: в неё
  // он и улетит.
  useEffect(() => {
    if (settled && tiles && activeId && !leaving) setHiddenTile(tiles, activeId);
  }, [activeId, leaving, settled, tiles]);

  useEffect(() => {
    leaveRef.current = (direction) => leave(activeId, base, direction);
  }, [activeId, base, leave]);

  const close = useCallback(() => leaveRef.current(0), []);

  // Взведённое окно «назад» просто убирает: показывать ещё нечего.
  useEffect(() => {
    backRef.current = armed ? onClose : close;
  }, [armed, backRef, close, onClose]);

  // Перелёт — когда окно на экране, палец отпущен и картинка плитки в окне
  // нарисована. Всё это приходит событиями, и каждое сразу пробует начать:
  // через состояние и эффект старт отставал бы на кадр.
  const initialId = initial?.id ?? null;
  const gate = useRef({ thumb: !hasThumb, armed });
  const tryLaunch = useCallback(() => {
    if (windowShown.isShown() && gate.current.thumb && !gate.current.armed) {
      launch(origin ? initialId : null);
    }
  }, [initialId, launch, origin, windowShown]);

  useEffect(() => windowShown.setListener(tryLaunch), [tryLaunch, windowShown]);

  useEffect(() => {
    gate.current.armed = armed;
    if (armed) return;

    tryLaunch();
    // Картинка плитки не нарисовалась — летим без неё.
    const fallback = setTimeout(() => {
      gate.current.thumb = true;
      tryLaunch();
    }, fallbackMs);

    return () => clearTimeout(fallback);
  }, [armed, fallbackMs, tryLaunch]);

  const onSourceShown = useCallback(() => {
    gate.current.thumb = true;
    tryLaunch();
  }, [tryLaunch]);

  const registerToggle = useCallback((index: number, toggle: (() => void) | null) => {
    if (toggle) togglesRef.current.set(index, toggle);
    else togglesRef.current.delete(index);
  }, []);

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: theme.viewerBackground }, backgroundStyle]}
      />

      <GestureDetector gesture={gesture}>
        <View
          testID="media-viewer"
          style={styles.container}
          pointerEvents={leaving ? 'none' : 'auto'}
        >
          <Animated.View style={[styles.pager, { width: width * items.length }, pagerStyle]}>
            {items.map((item, index) => (
              <View key={item.id} style={[styles.page, { left: index * width, width, height }]}>
                {/* До конца перелёта — только открытая страница: соседи
                    утяжелили бы первый кадр окна. */}
                {Math.abs(index - activeIndex) <= (settled ? PAGE_WINDOW : 0) ? (
                  <Animated.View style={[styles.container, index === activeIndex && activeStyle]}>
                    <MediaViewerPage
                      item={item}
                      index={index}
                      width={width}
                      height={height}
                      isActive={index === activeIndex}
                      motion={motion}
                      sourceTile={index === initialIndex ? sourceTile : null}
                      settled={settled}
                      leaving={leaving}
                      onSourceShown={index === initialIndex ? onSourceShown : undefined}
                      onToggleReady={registerToggle}
                    />
                  </Animated.View>
                ) : null}
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View
        pointerEvents={leaving ? 'none' : 'box-none'}
        style={[styles.closeWrap, { top: insets.top + Spacing.two }, chromeStyle]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть просмотр"
          onPress={close}
          style={[styles.closeButton, { backgroundColor: theme.mediaScrim }]}
        >
          <Text variant="bodyBold" color="textInverse">
            ✕
          </Text>
        </Pressable>
      </Animated.View>
    </>
  );
}
