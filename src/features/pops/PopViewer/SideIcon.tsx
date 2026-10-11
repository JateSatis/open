import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, type LayoutChangeEvent } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

const noop = () => undefined;

export type SideIconProps = {
  name: SymbolViewProps['name'];
  label: string;
  testID: string;
  /** Нет — индикатор без действия. */
  onPress?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Число под значком — как у просмотров. */
  count?: string;
};

/** Кнопка боковой колонки просмотра: белый значок с тенью прямо на видео. */
export function SideIcon({ name, label, testID, onPress, onLayout, count }: SideIconProps) {
  const theme = useTheme();

  return (
    <Pressable
      onLayout={onLayout}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Индикатор без действия глотает тап: он не должен уйти видео как пауза.
      onPress={onPress ?? noop}
      hitSlop={Spacing.one}
      style={[
        count === undefined ? styles.sideButton : styles.sideStat,
        styles.onMediaShadow,
        { shadowColor: theme.shadow },
      ]}
    >
      <SymbolView name={name} size={Sizes.popSideIcon} tintColor={theme.textOnMedia} />
      {count === undefined ? null : (
        <Text
          variant="smallBold"
          color="textOnMedia"
          style={[styles.onMediaText, { textShadowColor: theme.shadow }]}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
}
