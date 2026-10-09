import { useState } from 'react';
import type { ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdjustSlider } from './AdjustSlider';
import type { LiveAdjust } from './EditedPhoto';
import { styles } from './styles';
import { ToolActions } from './ToolActions';

import { useTheme } from '@/hooks/use-theme';

export type ColorToolProps = {
  live: LiveAdjust;
  style: AnimatedStyle<ViewStyle>;
  /** Панель сейчас на экране и принимает касания. */
  active: boolean;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
  onLayout: (height: number) => void;
};

/**
 * Панель «Настройка цвета»: экспозиция, контраст, насыщенность. Крестик
 * отменяет всё, что сделано в этом заходе, галочка применяет. «Сбросить»
 * виден, только пока хоть один ползунок не в нуле.
 */
export function ColorTool({
  live,
  style,
  active,
  onReset,
  onCancel,
  onDone,
  onLayout,
}: ColorToolProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [changed, setChanged] = useState(false);

  useAnimatedReaction(
    () => live.exposure.value !== 0 || live.contrast.value !== 0 || live.saturation.value !== 0,
    (now, before) => {
      if (now !== before) runOnJS(setChanged)(now);
    },
  );

  return (
    <Animated.View
      testID="media-preview-color-tool"
      pointerEvents={active ? 'auto' : 'none'}
      // Спрятанная панель не должна читаться с экрана.
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
      style={[
        styles.toolPanel,
        { paddingBottom: insets.bottom, backgroundColor: theme.viewerBackground },
        style,
      ]}
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
    >
      <AdjustSlider testID="adjust-exposure" label="Экспозиция" value={live.exposure} />
      <AdjustSlider testID="adjust-contrast" label="Контраст" value={live.contrast} />
      <AdjustSlider testID="adjust-saturation" label="Насыщенность" value={live.saturation} />

      <ToolActions changed={changed} onCancel={onCancel} onReset={onReset} onDone={onDone} />
    </Animated.View>
  );
}
