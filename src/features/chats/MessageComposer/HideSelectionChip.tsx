import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { ComposerSizes, Radii, Spacing } from '@/theme';

export type HideSelectionChipProps = {
  /** Выделенное уже скрыто — кнопка его показывает. */
  covered: boolean;
  onPress: () => void;
};

/**
 * Под полем ввода, пока в нём выделен текст: «Скрыть от зрителей» или, если
 * выделенное уже скрыто, «Показать зрителям». Участники чата видят всё.
 */
export function HideSelectionChip({ covered, onPress }: HideSelectionChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="composer-hide-selection"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      <SymbolView
        name={
          covered
            ? { ios: 'eye', android: 'visibility', web: 'visibility' }
            : { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }
        }
        size={ComposerSizes.fieldIcon}
        tintColor={theme.text}
      />
      <Text variant="small">{covered ? 'Показать зрителям' : 'Скрыть от зрителей'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: Spacing.two,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radii.full,
  },
});
