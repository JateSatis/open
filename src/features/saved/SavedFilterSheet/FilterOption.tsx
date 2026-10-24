import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type FilterOptionProps = {
  label: string;
  selected: boolean;
  /** Пока выбрать нельзя (нет таких сообщений) — серый, не нажимается. */
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
};

/** Вариант группы листа фильтров: выбранный — цветом действия, остальные — серые. */
export function FilterOption({ label, selected, disabled = false, onPress, testID }: FilterOptionProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.option,
        { backgroundColor: selected ? theme.primary : theme.backgroundElement },
        disabled && styles.optionDisabled,
      ]}
    >
      <Text variant="smallBold" color={selected ? 'primaryText' : 'textSecondary'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
