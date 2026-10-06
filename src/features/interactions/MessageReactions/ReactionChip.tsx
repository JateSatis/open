import { Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { styles } from './styles';
import { chipColors, type ReactionsTone } from './tones';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

const APPEAR_MS = 160;

export type ReactionChipProps = {
  emoji: string;
  count: number;
  mine: boolean;
  tone: ReactionsTone;
  /** Без обработчика чип не нажимается: это чужой ряд или копия облачка в меню. */
  onPress?: () => void;
  /**
   * Чужой ряд в живом облачке: касание чип забирает себе и ничего не делает —
   * иначе оно ушло бы строке и открыло меню. В копии облачка чип касание
   * пропускает, как и раньше.
   */
  swallowsTouch?: boolean;
};

const noop = () => undefined;

/** Реакция участников в облачке: эмодзи и сколько людей её поставили. */
export function ReactionChip({
  emoji,
  count,
  mine,
  tone,
  onPress,
  swallowsTouch = false,
}: ReactionChipProps) {
  const theme = useTheme();
  const colors = chipColors(tone, mine);

  return (
    <Animated.View
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      layout={LinearTransition.duration(APPEAR_MS)}
    >
      <Pressable
        testID={`reaction-chip-${emoji}`}
        accessibilityRole="button"
        accessibilityLabel={`${emoji} ${count}`}
        accessibilityState={{ selected: mine, disabled: !onPress }}
        // Глотающий чип не выключен, но для чтеца «недоступен»: `disabled`
        // у Pressable перезаписал бы это состояние.
        disabled={onPress || swallowsTouch ? undefined : true}
        hitSlop={4}
        onPress={onPress ?? (swallowsTouch ? noop : undefined)}
        style={[styles.chip, { backgroundColor: theme[colors.background] }]}
      >
        <Text variant="small">{emoji}</Text>
        {/* Новое число проявляется, а не подменяется скачком. */}
        <Animated.View key={count} entering={FadeIn.duration(APPEAR_MS)}>
          <Text variant="smallBold" color={colors.text}>
            {count}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
