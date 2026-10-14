import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

export type SaveCheckProps = {
  enabled: boolean;
  saving: boolean;
  onPress: () => void;
};

/** Галочка «Сохранить» справа в шапке; пока сохраняется — крутилка. */
export function SaveCheck({ enabled, saving, onPress }: SaveCheckProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="channel-edit-save"
      accessibilityRole="button"
      accessibilityLabel="Сохранить"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={Spacing.three}
      onPress={onPress}
    >
      {saving ? (
        <ActivityIndicator accessibilityLabel="Сохранение" />
      ) : (
        <SymbolView
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          size={InfoPageSizes.barIcon}
          tintColor={enabled ? theme.primary : theme.textSecondary}
        />
      )}
    </Pressable>
  );
}
