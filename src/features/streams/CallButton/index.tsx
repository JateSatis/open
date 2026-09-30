import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type CallButtonProps = {
  /** В чате уже идёт звонок — кнопка ведёт в него, а не создаёт новый. */
  live: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** Трубка в шапке чата. Её видят только участники: посетитель звонок не начинает. */
export function CallButton({ live, disabled, onPress }: CallButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="call-button"
      accessibilityRole="button"
      accessibilityLabel={live ? 'Присоединиться к звонку' : 'Позвонить'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={Spacing.three}
      onPress={onPress}
    >
      <SymbolView
        name={{ ios: 'phone.fill', android: 'call', web: 'call' }}
        size={Sizes.callIcon + Spacing.one}
        tintColor={live ? theme.callBar : theme.primary}
      />
    </Pressable>
  );
}
