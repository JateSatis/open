// Слой на низкоуровневом API Reanimated: мутация `.value` у shared value —
// штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColorTool } from './ColorTool';
import { PreviewFooter } from './PreviewFooter';
import { PreviewHeader } from './PreviewHeader';
import type { PreviewMotion } from './PreviewPage';
import { PreviewPager } from './PreviewPager';
import { setPreviewBackHandler, useMediaPreview, type Rect } from './previewStore';
import { PreviewToast, usePreviewToast } from './PreviewToast';
import { styles } from './styles';
import { useColorTool } from './useColorTool';
import { usePreviewFlight } from './usePreviewFlight';

import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { useGridGeometry } from '@/features/media/MediaGrid/useGridGeometry';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useMediaSelection } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

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

  const tool = useColorTool();
  const toast = usePreviewToast();
  const keyboardHeight = useOwnKeyboardHeight('sheet');
  const { flight, origin, fade, leaving, launch, leave, dissolve } = usePreviewFlight(
    target?.origin ?? null,
    gridViewport,
  );
  const toolArea = useSharedValue<Rect>({ x: 0, y: 0, width: size.width, height: size.height });

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

  const currentAssetId = current?.id;
  const goBack = useCallback(() => {
    if (currentAssetId) leave(currentAssetId);
  }, [currentAssetId, leave]);

  // «Назад» системы: открытый инструмент закрывается как «Отмена», иначе — предпросмотр.
  const toolOpen = tool.open;
  const cancelTool = tool.cancel;

  useEffect(() => {
    setPreviewBackHandler(toolOpen ? cancelTool : goBack);

    return () => setPreviewBackHandler(null);
  }, [cancelTool, goBack, toolOpen]);

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
            leaving={leaving}
            onShown={launch}
            onPage={onPage}
          />
        </View>
      </GestureDetector>

      <PreviewHeader
        title={title}
        assetId={current.id}
        style={chromeStyle}
        hidden={tool.open}
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
        hidden={tool.open}
        onSend={send}
        onOpenColor={() => tool.start(current)}
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

      <PreviewToast toast={toast} bottom={footerHeight + Spacing.three} />
    </View>
  );
}
