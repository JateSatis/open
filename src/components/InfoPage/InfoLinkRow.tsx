import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import type { InfoIcon } from './types';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

export type InfoLinkRowProps = {
  icon: InfoIcon;
  label: string;
  onPress: () => void;
  testID?: string;
};

/** Строка-действие карточки: иконка цветом действия и подпись — «Добавить участников». */
export function InfoLinkRow({ icon, label, onPress, testID }: InfoLinkRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}
    >
      <SymbolView name={icon} size={InfoPageSizes.barIcon} tintColor={theme.primary} />
      <Text variant="body" color="primary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: InfoPageSizes.cardRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
});
