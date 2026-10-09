import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawPanel } from './DrawPanel';
import { DrawSizeSlider } from './DrawSizeSlider';
import { fitRect } from './previewGeometry';
import type { Rect } from './previewStore';
import { styles } from './styles';
import { useDrawGestures } from './useDrawGestures';
import type { DrawToolState } from './useDrawTool';

import { drawColorOf, useDrawSettings } from '@/features/media/drawSettings';
import { cropAspect } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes, Spacing } from '@/theme';

export type DrawToolProps = {
  tool: DrawToolState;
  /** Весь слой предпросмотра и рабочая область фото — на UI-потоке. */
  screen: SharedValue<Rect>;
  area: SharedValue<Rect>;
  onPanelLayout: (height: number) => void;
};

/**
 * «Рисование» поверх предпросмотра: касания по фото, крестик вверху слева,
 * ползунок толщины у правого края и панель кистей внизу. Всё проявляется
 * вместе с ужатием фото и гаснет на выходе. Смонтировано всегда, как и
 * панели других инструментов: высота панели известна до первого захода, и
 * фото ужимается сразу куда нужно.
 */
export function DrawTool({ tool, screen, area, onPanelLayout }: DrawToolProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useDrawSettings();
  const sizing = useSharedValue(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const crop = tool.session?.crop ?? null;
  const gesture = useDrawGestures(tool, crop, screen, area);
  const { progress, size } = tool;
  const color = drawColorOf(settings, tool.brush);
  const aspect = crop ? cropAspect(crop) : 1;

  const chromeStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * Spacing.five }],
  }));
  // Превью толщины — по центру фото, той же величины, что ляжет штрих.
  const previewStyle = useAnimatedStyle(() => {
    const frame = fitRect(aspect, area.value);
    const value = size.value;

    return {
      opacity: sizing.value * Opacity.drawSizePreview,
      width: value,
      height: value,
      borderRadius: value / 2,
      left: frame.x + frame.width / 2 - value / 2,
      top: frame.y + frame.height / 2 - value / 2,
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <View
          testID="media-preview-draw-canvas"
          style={StyleSheet.absoluteFill}
          pointerEvents={tool.open && crop ? 'auto' : 'none'}
        />
      </GestureDetector>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.sizePreview,
          {
            backgroundColor: color ?? theme.textOnMedia,
            borderColor: theme.textOnMedia,
          },
          previewStyle,
        ]}
      />

      <Animated.View
        pointerEvents={tool.open ? 'box-none' : 'none'}
        style={[styles.drawTop, { paddingTop: insets.top + Spacing.two }, chromeStyle]}
      >
        <Pressable
          testID="draw-cancel"
          accessibilityRole="button"
          accessibilityLabel="Отменить рисование"
          accessibilityState={{ disabled: !tool.dirty }}
          disabled={!tool.dirty}
          hitSlop={Spacing.two}
          onPress={tool.cancel}
          style={[styles.headerButton, !tool.dirty && { opacity: Opacity.toolIdle }]}
        >
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>
      </Animated.View>

      <Animated.View
        pointerEvents={tool.open ? 'box-none' : 'none'}
        style={[
          styles.sizeColumn,
          {
            top: insets.top + Sizes.previewHeaderButton + Spacing.three,
            bottom: panelHeight + Spacing.three,
          },
          chromeStyle,
        ]}
      >
        <DrawSizeSlider size={size} sizing={sizing} onCommit={tool.commitSize} />
      </Animated.View>

      <DrawPanel
        brush={tool.brush}
        color={color}
        canUndo={tool.canUndo}
        hasDrawing={tool.hasDrawing}
        style={panelStyle}
        active={tool.open}
        onBrush={tool.selectBrush}
        onUndo={tool.undo}
        onReset={tool.reset}
        onDone={tool.done}
        onLayout={(height) => {
          setPanelHeight(height);
          onPanelLayout(height);
        }}
      />
    </View>
  );
}
