// Инструмент на низкоуровневом API Reanimated: мутация `.value` у shared
// value — штатный способ им пользоваться.
/* eslint-disable react-hooks/immutability */
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedReaction,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdjustSlider } from './AdjustSlider';
import type { LiveAdjust } from './EditedPhoto';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** «Сбросить» возвращает ползунки к нулю не рывком. */
const RESET_MS = 250;

export type ColorToolProps = {
  live: LiveAdjust;
  style: AnimatedStyle<ViewStyle>;
  /** Панель сейчас на экране и принимает касания. */
  active: boolean;
  onCancel: () => void;
  onDone: () => void;
  onLayout: (height: number) => void;
};

/**
 * Панель «Настройка цвета»: экспозиция, контраст, насыщенность. Крестик
 * отменяет всё, что сделано в этом заходе, галочка применяет. «Сбросить»
 * виден, только пока хоть один ползунок не в нуле.
 */
export function ColorTool({ live, style, active, onCancel, onDone, onLayout }: ColorToolProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [changed, setChanged] = useState(false);

  useAnimatedReaction(
    () => live.exposure.value !== 0 || live.contrast.value !== 0 || live.saturation.value !== 0,
    (now, before) => {
      if (now !== before) runOnJS(setChanged)(now);
    },
  );

  const reset = () => {
    live.exposure.value = withTiming(0, { duration: RESET_MS });
    live.contrast.value = withTiming(0, { duration: RESET_MS });
    live.saturation.value = withTiming(0, { duration: RESET_MS });
  };

  return (
    <Animated.View
      testID="media-preview-color-tool"
      pointerEvents={active ? 'auto' : 'none'}
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

      <View style={styles.toolActions}>
        <Pressable
          testID="media-preview-tool-cancel"
          accessibilityRole="button"
          accessibilityLabel="Отменить"
          hitSlop={Spacing.two}
          onPress={onCancel}
          style={styles.tool}
        >
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>

        {changed ? (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <Pressable
              testID="media-preview-tool-reset"
              accessibilityRole="button"
              hitSlop={Spacing.two}
              onPress={reset}
            >
              <Text variant="smallBold" color="textOnMedia">
                Сбросить
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <Pressable
          testID="media-preview-tool-done"
          accessibilityRole="button"
          accessibilityLabel="Применить"
          hitSlop={Spacing.two}
          onPress={onDone}
          style={styles.tool}
        >
          <SymbolView
            name={{ ios: 'checkmark', android: 'check', web: 'check' }}
            size={Spacing.four}
            tintColor={theme.primary}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}
