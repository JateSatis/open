import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type ToolActionsProps = {
  /** Есть что сбрасывать — виден «Сбросить». */
  changed: boolean;
  onCancel: () => void;
  onReset: () => void;
  onDone: () => void;
};

/**
 * Нижний ряд инструмента: крестик отменяет всё, что сделано в этом заходе,
 * «Сбросить» возвращает к исходному, галочка применяет.
 */
export function ToolActions({ changed, onCancel, onReset, onDone }: ToolActionsProps) {
  const theme = useTheme();

  return (
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
  );
}
