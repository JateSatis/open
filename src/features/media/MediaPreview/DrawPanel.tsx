import { SymbolView } from 'expo-symbols';
import { Pressable, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, type AnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawBrushRow } from './DrawBrushRow';
import { styles } from './styles';

import { Text } from '@/components/Text';
import type { DrawBrush } from '@/features/media/photoEdits/drawing';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Spacing } from '@/theme';

export type DrawPanelProps = {
  brush: DrawBrush;
  /** Цвет выбранной кисти; нет — у неё цвета нет. */
  color: string | null;
  canUndo: boolean;
  hasDrawing: boolean;
  style: AnimatedStyle<ViewStyle>;
  /** Панель на экране и принимает касания. */
  active: boolean;
  onBrush: (brush: DrawBrush) => void;
  onUndo: () => void;
  onReset: () => void;
  onDone: () => void;
  onLayout: (height: number) => void;
};

/**
 * Панель «Рисование»: кисти и кружок цвета, ниже — отмена последнего шага,
 * «Сбросить» (пока есть рисунок) и применить.
 */
export function DrawPanel({
  brush,
  color,
  canUndo,
  hasDrawing,
  style,
  active,
  onBrush,
  onUndo,
  onReset,
  onDone,
  onLayout,
}: DrawPanelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      testID="media-preview-draw-tool"
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
      <DrawBrushRow brush={brush} color={color} onBrush={onBrush} />

      <View style={styles.toolActions}>
        <Pressable
          testID="draw-undo"
          accessibilityRole="button"
          accessibilityLabel="Отменить последнее действие"
          accessibilityState={{ disabled: !canUndo }}
          disabled={!canUndo}
          hitSlop={Spacing.two}
          onPress={onUndo}
          style={[styles.tool, !canUndo && { opacity: Opacity.toolIdle }]}
        >
          <SymbolView
            name={{ ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>

        {hasDrawing ? (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <Pressable
              testID="media-preview-tool-reset"
              accessibilityRole="button"
              hitSlop={Spacing.two}
              onPress={onReset}
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
