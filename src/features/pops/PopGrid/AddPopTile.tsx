import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

/** Плитка «+»: новый поп. `label` — подпись под знаком, в шите она нужна. */
export const AddPopTile = memo(function AddPopTile({
  label,
  onPress,
  disabled = false,
}: {
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      testID="pop-add-tile"
      accessibilityRole="button"
      accessibilityLabel="Новый поп"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.add,
        { backgroundColor: theme.backgroundElement },
        (pressed || disabled) && { opacity: disabled ? Opacity.unavailable : Opacity.pressed },
      ]}
    >
      <SymbolView
        name={{ ios: 'plus', android: 'add', web: 'add' }}
        size={Sizes.popAddIcon}
        tintColor={theme.text}
      />
      {label ? (
        <Text variant="small" style={styles.addLabel}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
});
