import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type CallControlProps = {
  label: string;
  icon: SymbolViewProps['name'];
  /** Включено (громкая связь) — кнопка светлая. */
  active?: boolean;
  tone?: 'default' | 'danger';
  onPress: () => void;
  testID?: string;
};

/** Круглая кнопка экрана звонка с подписью под ней. */
export function CallControl({
  label,
  icon,
  active,
  tone = 'default',
  onPress,
  testID,
}: CallControlProps) {
  const theme = useTheme();
  const background =
    tone === 'danger' ? theme.danger : active ? theme.callControlActive : theme.callControl;

  return (
    <View style={styles.control}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={active === undefined ? undefined : { selected: active }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.round,
          { backgroundColor: background, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <SymbolView
          name={icon}
          size={Sizes.callControlIcon}
          tintColor={active && tone !== 'danger' ? theme.callBackground : theme.textOnMedia}
        />
      </Pressable>
      <Text variant="caption" color="textOnMedia">
        {label}
      </Text>
    </View>
  );
}
