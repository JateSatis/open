// Слой на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColorTool } from './ColorTool';
import { PreviewFooter } from './PreviewFooter';
import { PreviewHeader } from './PreviewHeader';
import { PreviewPage, type PreviewMotion } from './PreviewPage';
import {
  closeMediaPreview,
  measureGridCell,
  setPreviewBackHandler,
  useMediaPreview,
  type Rect,
} from './previewStore';
import { PreviewToast, usePreviewToast } from './PreviewToast';
import { styles } from './styles';
import { useColorTool } from './useColorTool';

import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { useGridGeometry } from '@/features/media/MediaGrid/useGridGeometry';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Перелёт из плитки и обратно. */
const FLIGHT_MS = 280;
const FLIGHT_EASING = Easing.out(Easing.cubic);
/** Столько ждём превью перед перелётом, дальше летим без него. */
const LAUNCH_FALLBACK_MS = 400;

export type PreviewLayerProps = {
  /** Имя чата — в шапке. */
  title: string;
  text: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editing: boolean;
  /** Отправить выбранное — как «отправить» шита; шит закроется сам. */
  onSend: () => void;
  /** Где в окне видна сетка: файл улетает в плитку, только если она видна. */
  gridViewport: { top: number; bottom: number };
};

/**
 * Полноэкранный предпросмотр файлов шита: тёмный в обеих темах, поверх
 * сетки, в том же окне шита. Листает всю галерею в порядке сетки; кружок в
 * шапке выбирает текущий файл, внизу — подпись, отправка и инструменты фото.
 */
export function PreviewLayer({
  title,
  text,
  onChangeText,
  placeholder,
  editing,
  onSend,
  gridViewport,
}: PreviewLayerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const { cellSize } = useGridGeometry();

  const gallery = useMediaPreview((state) => state.gallery);
  const target = useMediaPreview((state) => state.target);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      gallery.findIndex((item) => item.id === target?.assetId),
    ),
  );
  const current: MediaLibraryItem | undefined = gallery[index];
  const [leaving, setLeaving] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  const [toolHeight, setToolHeight] = useState(0);

  const tool = useColorTool();
  const toast = usePreviewToast();
  const keyboardHeight = useOwnKeyboardHeight('sheet');

  const flight = useSharedValue(0);
  const origin = useSharedValue<Rect | null>(target?.origin ?? null);
  const toolArea = useSharedValue<Rect>({ x: 0, y: 0, width: size.width, height: size.height });
  const fade = useSharedValue(1);

  const motion = useMemo<PreviewMotion>(
    () => ({ flight, origin, tool: tool.progress, toolArea, fade }),
    [fade, flight, origin, tool.progress, toolArea],
  );

  // Рабочая область фото под панелью инструмента: фото не залезает под неё.
  useEffect(() => {
    toolArea.value = {
      x: Spacing.three,
      y: insets.top + Spacing.three,
      width: size.width - Spacing.three * 2,
      height: size.height - toolHeight - insets.top - Spacing.three * 2,
    };
  }, [insets.top, size, toolArea, toolHeight]);

  /**
   * Перелёт начинается, когда превью активной страницы уже нарисовано: иначе
   * анимация отыграла бы впустую, а фото появилось бы в конце, рывком. Если
   * превью почему-то не пришло — не держим человека дольше страховки.
   */
  const launched = useRef(false);
  const launch = useCallback(() => {
    if (launched.current) return;

    launched.current = true;
    flight.value = withTiming(1, { duration: FLIGHT_MS, easing: FLIGHT_EASING });
  }, [flight]);

  useEffect(() => {
    const fallback = setTimeout(launch, LAUNCH_FALLBACK_MS);

    return () => clearTimeout(fallback);
  }, [launch]);

  const leave = useCallback(() => {
    if (leaving || !current) return;

    setLeaving(true);
    void KeyboardController.dismiss();

    void measureGridCell(current.id).then((rect) => {
      const center = rect ? rect.y + rect.height / 2 : -1;
      const visible = rect !== null && center > gridViewport.top && center < gridViewport.bottom;

      if (visible) {
        origin.value = rect;
        flight.value = withTiming(0, { duration: FLIGHT_MS, easing: FLIGHT_EASING }, (finished) => {
          if (finished) runOnJS(closeMediaPreview)();
        });
        return;
      }

      // Плитки не видно — файл гаснет на месте, сетка не двигается.
      fade.value = withTiming(0, { duration: FLIGHT_MS }, (finished) => {
        if (finished) runOnJS(closeMediaPreview)();
      });
    });
  }, [current, fade, flight, gridViewport.bottom, gridViewport.top, leaving, origin]);

  // «Назад» системы: открытый инструмент закрывается как «Отмена», иначе — предпросмотр.
  const toolOpen = tool.open;
  const cancelTool = tool.cancel;

  useEffect(() => {
    setPreviewBackHandler(toolOpen ? cancelTool : leave);

    return () => setPreviewBackHandler(null);
  }, [cancelTool, leave, toolOpen]);

  const toggleCurrent = useCallback(() => {
    if (!current) return;

    const selection = useMediaSelection.getState();
    const selected = selection.order.includes(current.id);

    if (!selected && selection.order.length >= selection.limit) {
      toast.show(`Больше ${selection.limit} не выбрать`);
      return;
    }

    selection.toggle(current);
  }, [current, toast]);

  const send = useCallback(() => {
    const selection = useMediaSelection.getState();

    // Ничего не выбрано — уходит текущий файл, как в Telegram.
    if (selection.order.length === 0 && current) selection.toggle(current);

    if (useMediaSelection.getState().order.length === 0) return;

    setLeaving(true);
    void KeyboardController.dismiss();
    // Шит уезжает вниз, предпросмотр над ним тает за то же время.
    fade.value = withTiming(0, { duration: FLIGHT_MS });
    onSend();
  }, [current, fade, onSend]);

  const holdOriginal = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(120)
        .maxDistance(10_000)
        .enabled(tool.open)
        .onStart(() => {
          tool.live.original.value = 1;
        })
        .onFinalize(() => {
          tool.live.original.value = 0;
        }),
    [tool.live.original, tool.open],
  );

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value,
  }));
  // Гаснут части слоя, а не слой целиком: прозрачность всего слоя Android
  // рисует через отдельный буфер, и с видео внутри шит под ним пропадал.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value * (1 - tool.progress.value),
  }));
  const footerStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value * (1 - tool.progress.value),
    transform: [{ translateY: -Math.max(keyboardHeight.value - insets.bottom, 0) }],
  }));
  const toolStyle = useAnimatedStyle(() => ({
    opacity: tool.progress.value,
    transform: [{ translateY: (1 - tool.progress.value) * Spacing.five }],
  }));

  const renderItem = useCallback<ListRenderItem<MediaLibraryItem>>(
    ({ item, index: at }) => (
      <PreviewPage
        asset={item}
        width={size.width}
        height={size.height}
        cellSize={cellSize}
        isActive={at === index}
        motion={motion}
        live={at === index && tool.open ? tool.live : null}
        onShown={launch}
        leaving={leaving}
      />
    ),
    [cellSize, index, launch, leaving, motion, size.height, size.width, tool.live, tool.open],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<MediaLibraryItem> | null | undefined, at: number) => ({
      length: size.width,
      offset: size.width * at,
      index: at,
    }),
    [size.width],
  );

  const onPageSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / size.width);

      if (next !== index && gallery[next]) {
        // Пролистали — файл улетит в свою плитку, а не в ту, из которой вылетел.
        origin.value = null;
        setIndex(next);
      }
    },
    [gallery, index, origin, size.width],
  );

  if (!current) return null;

  const isPhoto = current.kind === 'photo';

  return (
    <Animated.View
      testID="media-preview"
      style={styles.layer}
      pointerEvents={leaving ? 'none' : 'auto'}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;

        if (width !== size.width || height !== size.height) setSize({ width, height });
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.viewerBackground },
          backgroundStyle,
        ]}
      />

      <GestureDetector gesture={holdOriginal}>
        <View style={StyleSheet.absoluteFill}>
          <FlatList
            testID="media-preview-pager"
            data={gallery}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            extraData={leaving ? -1 - index : index}
            horizontal
            pagingEnabled
            scrollEnabled={!tool.open}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={getItemLayout}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            onMomentumScrollEnd={onPageSettled}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      </GestureDetector>

      <PreviewHeader
        title={title}
        assetId={current.id}
        style={chromeStyle}
        onBack={leave}
        onToggle={toggleCurrent}
      />

      <PreviewFooter
        assetId={current.id}
        isPhoto={isPhoto}
        text={text}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editing={editing}
        style={footerStyle}
        onSend={send}
        onOpenColor={() => tool.start(current)}
        onLayout={setFooterHeight}
      />

      {isPhoto ? (
        <ColorTool
          live={tool.live}
          style={toolStyle}
          active={tool.open}
          onCancel={tool.cancel}
          onDone={tool.done}
          onLayout={setToolHeight}
        />
      ) : null}

      <PreviewToast toast={toast} bottom={footerHeight + Spacing.three} />
    </Animated.View>
  );
}
