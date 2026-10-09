// Слой на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColorTool } from './ColorTool';
import { CropOverlay } from './CropOverlay';
import { CropPanel } from './CropPanel';
import { DrawTool } from './DrawTool';
import { PreviewFooter } from './PreviewFooter';
import { PreviewHeader } from './PreviewHeader';
import type { PreviewMotion } from './PreviewPage';
import { PreviewPager } from './PreviewPager';
import { setPreviewBackHandler, useMediaPreview, type Rect } from './previewStore';
import { PreviewToast, usePreviewToast } from './PreviewToast';
import { styles } from './styles';
import { useColorTool } from './useColorTool';
import { useCropTool } from './useCropTool';
import { useDrawTool } from './useDrawTool';
import { usePreviewFlight } from './usePreviewFlight';

import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { useGridGeometry } from '@/features/media/MediaGrid/useGridGeometry';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Удержание пальца на фото в инструменте — показать оригинал. */
const HOLD_ORIGINAL_MS = 120;

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
  // Текущий файл — по id: галерея может дочитаться и сдвинуться под ним.
  const [currentId, setCurrentId] = useState(target?.assetId ?? null);
  const index = Math.max(
    0,
    gallery.findIndex((item) => item.id === currentId),
  );
  const current: MediaLibraryItem | undefined = gallery[index];
  const [footerHeight, setFooterHeight] = useState(0);
  const [toolHeight, setToolHeight] = useState(0);
  const [cropPanelHeight, setCropPanelHeight] = useState(0);
  const [drawPanelHeight, setDrawPanelHeight] = useState(0);
  /** Чья рабочая область у фото: цвета или рисования. Держится и на выходе. */
  const [areaOf, setAreaOf] = useState<'color' | 'draw'>('color');

  const tool = useColorTool();
  const crop = useCropTool();
  const draw = useDrawTool();
  const toast = usePreviewToast();
  const keyboardHeight = useOwnKeyboardHeight('sheet');
  const { flight, origin, fade, leaving, launch, leave, dissolve } = usePreviewFlight(
    target?.origin ?? null,
    gridViewport,
  );
  const toolArea = useSharedValue<Rect>({ x: 0, y: 0, width: size.width, height: size.height });
  const screen = useSharedValue<Rect>({ x: 0, y: 0, width: size.width, height: size.height });
  const colorProgress = tool.progress;
  const drawProgress = draw.progress;
  const toolProgress = useDerivedValue(() => Math.max(colorProgress.value, drawProgress.value));

  const motion = useMemo<PreviewMotion>(
    () => ({ flight, origin, tool: toolProgress, toolArea, fade, cropCover: crop.cover }),
    [crop.cover, fade, flight, origin, toolProgress, toolArea],
  );

  // Рабочая область фото под панелью инструмента: фото не залезает под неё.
  // У рисования сверху ещё крестик.
  useEffect(() => {
    const top = insets.top + Spacing.three + (areaOf === 'draw' ? Sizes.previewHeaderButton : 0);
    const panel = areaOf === 'draw' ? drawPanelHeight : toolHeight;

    toolArea.value = {
      x: Spacing.three,
      y: top,
      width: size.width - Spacing.three * 2,
      height: size.height - panel - top - Spacing.three,
    };
    screen.value = { x: 0, y: 0, width: size.width, height: size.height };
  }, [areaOf, drawPanelHeight, insets.top, screen, size, toolArea, toolHeight]);

  // Рабочее поле рамки обрезки: с запасом под уголки, над панелью.
  const cropArea = crop.motion.area;
  const cropScreen = crop.motion.screen;

  useEffect(() => {
    const inset = Spacing.four;

    cropArea.value = {
      x: inset,
      y: insets.top + inset,
      width: size.width - inset * 2,
      height: size.height - cropPanelHeight - insets.top - inset * 2,
    };
    cropScreen.value = { x: 0, y: 0, width: size.width, height: size.height };
  }, [cropArea, cropPanelHeight, cropScreen, insets.top, size]);

  const currentAssetId = current?.id;
  const goBack = useCallback(() => {
    if (currentAssetId) leave(currentAssetId);
  }, [currentAssetId, leave]);

  // «Назад» системы: открытый инструмент закрывается как «Отмена», иначе — предпросмотр.
  const toolOpen = tool.open;
  const cancelTool = tool.cancel;
  const cropOpen = crop.open;
  const cancelCrop = crop.cancel;
  const drawOpen = draw.open;
  const cancelDraw = draw.cancel;

  useEffect(() => {
    const back = drawOpen ? cancelDraw : cropOpen ? cancelCrop : toolOpen ? cancelTool : goBack;

    setPreviewBackHandler(back);

    return () => setPreviewBackHandler(null);
  }, [cancelCrop, cancelDraw, cancelTool, cropOpen, drawOpen, goBack, toolOpen]);

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

    // Ничего не выбрано — уходит текущий файл, как в Telegram. В правке
    // альбома — нет: «сохранить» сохраняет правку, а не добавляет файл,
    // который просто открыли посмотреть.
    if (!editing && selection.order.length === 0 && current) selection.toggle(current);

    if (!editing && useMediaSelection.getState().order.length === 0) return;

    dissolve();
    onSend();
  }, [current, dissolve, editing, onSend]);

  const onPage = useCallback(
    (asset: MediaLibraryItem) => {
      // Пролистали — файл улетит в свою плитку, а не в ту, из которой вылетел.
      origin.value = null;
      setCurrentId(asset.id);
    },
    [origin],
  );

  const holdOriginal = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(HOLD_ORIGINAL_MS)
        .maxDistance(Number.MAX_SAFE_INTEGER)
        .enabled(tool.open)
        .onStart(() => {
          tool.live.original.value = 1;
        })
        .onFinalize(() => {
          tool.live.original.value = 0;
        }),
    [tool.live.original, tool.open],
  );

  // Гаснут части слоя, а не слой целиком: прозрачность всего слоя Android
  // рисует через отдельный буфер, и с видео внутри шит под ним пропадал.
  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value,
  }));
  const cropEnter = crop.motion.enter;
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value * (1 - Math.max(toolProgress.value, cropEnter.value)),
  }));
  const footerStyle = useAnimatedStyle(() => ({
    opacity: flight.value * fade.value * (1 - Math.max(toolProgress.value, cropEnter.value)),
    transform: [{ translateY: -Math.max(keyboardHeight.value - insets.bottom, 0) }],
  }));
  const toolStyle = useAnimatedStyle(() => ({
    opacity: tool.progress.value,
    transform: [{ translateY: (1 - tool.progress.value) * Spacing.five }],
  }));
  const cropPanelStyle = useAnimatedStyle(() => ({
    opacity: cropEnter.value,
    transform: [{ translateY: (1 - cropEnter.value) * Spacing.five }],
  }));
  const anyTool = tool.open || crop.open || draw.open;

  if (!current) return null;

  const isPhoto = current.kind === 'photo';

  return (
    <View
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
          <PreviewPager
            gallery={gallery}
            index={index}
            width={size.width}
            height={size.height}
            cellSize={cellSize}
            motion={motion}
            live={tool.open ? tool.live : null}
            draw={draw.session ? draw.live : null}
            locked={anyTool}
            leaving={leaving}
            onShown={launch}
            onPage={onPage}
          />
        </View>
      </GestureDetector>

      {crop.session ? (
        <CropOverlay
          session={crop.session}
          motion={crop.motion}
          rotationBase={crop.rotationBase}
          active={crop.open}
          onReady={crop.ready}
        />
      ) : null}

      <PreviewHeader
        title={title}
        assetId={current.id}
        style={chromeStyle}
        hidden={anyTool}
        onBack={goBack}
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
        hidden={anyTool}
        onSend={send}
        onOpenColor={() => {
          setAreaOf('color');
          tool.start(current);
        }}
        onOpenCrop={() => crop.start(current)}
        onOpenDraw={() => {
          setAreaOf('draw');
          draw.start(current);
        }}
        onLayout={setFooterHeight}
      />

      {isPhoto ? (
        <ColorTool
          live={tool.live}
          style={toolStyle}
          active={tool.open}
          onReset={tool.reset}
          onCancel={tool.cancel}
          onDone={tool.done}
          onLayout={setToolHeight}
        />
      ) : null}

      {isPhoto ? (
        <CropPanel
          motion={crop.motion}
          rotationBase={crop.rotationBase}
          style={cropPanelStyle}
          active={crop.open}
          onMirror={crop.mirror}
          onRotate={crop.rotate}
          onReset={crop.reset}
          onCancel={crop.cancel}
          onDone={crop.done}
          onLayout={setCropPanelHeight}
        />
      ) : null}

      {isPhoto ? (
        <DrawTool tool={draw} screen={screen} area={toolArea} onPanelLayout={setDrawPanelHeight} />
      ) : null}

      <PreviewToast toast={toast} bottom={footerHeight + Spacing.three} />
    </View>
  );
}
