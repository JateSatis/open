import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawAlphaSlider } from './DrawAlphaSlider';
import { DrawPaletteGrid } from './DrawPaletteGrid';
import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type DrawColorPanelProps = {
  /** Цвет текущей кисти `#rrggbbaa`. */
  color: string;
  /** Прозрачность с ползунка. */
  alpha: SharedValue<number>;
  /** 0 — спрятана, 1 — на месте; на UI-потоке. */
  progress: SharedValue<number>;
  /** Панель открыта и принимает касания. */
  active: boolean;
  onPick: (rgb: string) => void;
  onBack: () => void;
  onEyedropper: () => void;
};

/**
 * Панель цвета на месте обоих нижних рядов рисования: сетка цветов, под ней
 * «назад», ползунок прозрачности и пипетка. Выше рядов кистей — ложится
 * поверх низа фото, а само фото не сдвигается.
 */
export function DrawColorPanel({
  color,
  alpha,
  progress,
  active,
  onPick,
  onBack,
  onEyedropper,
}: DrawColorPanelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * Spacing.five }],
  }));

  return (
    <Animated.View
      testID="draw-color-panel"
      pointerEvents={active ? 'auto' : 'none'}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
      style={[
        styles.colorPanel,
        { paddingBottom: insets.bottom, backgroundColor: theme.viewerBackground },
        style,
      ]}
    >
      <DrawPaletteGrid color={color} alpha={alpha} onPick={onPick} />

      <View style={styles.colorRow}>
        <Pressable
          testID="draw-color-back"
          accessibilityRole="button"
          accessibilityLabel="Закрыть цвета"
          hitSlop={Spacing.two}
          onPress={onBack}
          style={styles.tool}
        >
          <SymbolView
            name={{ ios: 'chevron.backward', android: 'arrow_back', web: 'arrow_back' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>

        <DrawAlphaSlider color={color} alpha={alpha} />

        <Pressable
          testID="draw-eyedropper"
          accessibilityRole="button"
          accessibilityLabel="Пипетка"
          hitSlop={Spacing.two}
          onPress={onEyedropper}
          style={styles.tool}
        >
          <SymbolView
            name={{ ios: 'eyedropper', android: 'colorize', web: 'colorize' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}
