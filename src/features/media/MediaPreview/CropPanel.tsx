import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AngleRuler } from './AngleRuler';
import type { CropMotion } from './cropMotion';
import { styles } from './styles';
import { ToolActions } from './ToolActions';

import { isEmptyCrop, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type CropPanelProps = {
  motion: CropMotion;
  rotationBase: SharedValue<PhotoCrop | null>;
  style: AnimatedStyle<ViewStyle>;
  /** Панель сейчас на экране и принимает касания. */
  active: boolean;
  onMirror: () => void;
  onRotate: () => void;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
  onLayout: (height: number) => void;
};

/**
 * Панель «Обрезка и поворот»: линейка точного поворота, слева от неё
 * отражение, справа — поворот на 90° против часовой. Ниже — отмена,
 * «Сбросить» (пока обрезка не исходная) и применить.
 */
export function CropPanel({
  motion,
  rotationBase,
  style,
  active,
  onMirror,
  onRotate,
  onReset,
  onCancel,
  onDone,
  onLayout,
}: CropPanelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [changed, setChanged] = useState(false);

  useAnimatedReaction(
    () => !isEmptyCrop(motion.crop.value),
    (now, before) => {
      if (now !== before) runOnJS(setChanged)(now);
    },
  );

  return (
    <Animated.View
      testID="media-preview-crop-tool"
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
      <View style={styles.rulerRow}>
        <Pressable
          testID="crop-mirror"
          accessibilityRole="button"
          accessibilityLabel="Отразить"
          hitSlop={Spacing.two}
          onPress={onMirror}
          style={styles.tool}
        >
          <SymbolView
            name={{
              ios: 'arrow.left.and.right.righttriangle.left.righttriangle.right',
              android: 'flip',
              web: 'flip',
            }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>

        <AngleRuler motion={motion} rotationBase={rotationBase} />

        <Pressable
          testID="crop-rotate"
          accessibilityRole="button"
          accessibilityLabel="Повернуть на 90°"
          hitSlop={Spacing.two}
          onPress={onRotate}
          style={styles.tool}
        >
          <SymbolView
            name={{ ios: 'rotate.left', android: 'rotate_90_degrees_ccw', web: 'rotate_left' }}
            size={Spacing.four}
            tintColor={theme.textOnMedia}
          />
        </Pressable>
      </View>

      <ToolActions changed={changed} onCancel={onCancel} onReset={onReset} onDone={onDone} />
    </Animated.View>
  );
}
