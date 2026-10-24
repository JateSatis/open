import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type SelectionCheckProps = {
  checked: boolean;
  /** `small` — на облачке, `regular` — в строке списка. */
  size?: 'regular' | 'small';
  /** Цвета на синем облачке: обводка и заливка — белые. */
  onPrimary?: boolean;
  testID?: string;
};

/** Круглая отметка: пустой кружок или заливка с галочкой. Нажатия — у строки вокруг. */
export function SelectionCheck({
  checked,
  size = 'regular',
  onPrimary = false,
  testID,
}: SelectionCheckProps) {
  const theme = useTheme();
  const side = size === 'small' ? Sizes.selectionCheckSmall : Sizes.selectionCheck;
  const accent = onPrimary ? theme.primaryText : theme.primary;

  return (
    <View
      testID={testID}
      accessibilityState={{ checked }}
      style={[
        styles.check,
        { width: side, height: side },
        checked
          ? { backgroundColor: accent, borderColor: accent }
          : { borderColor: onPrimary ? theme.metaOnPrimary : theme.textSecondary },
      ]}
    >
      {checked ? (
        <SymbolView
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          size={side * 0.7}
          weight="bold"
          tintColor={onPrimary ? theme.primary : theme.primaryText}
        />
      ) : null}
    </View>
  );
}
