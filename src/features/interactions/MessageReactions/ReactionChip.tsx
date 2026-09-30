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
};

/** Реакция участников в облачке: эмодзи и сколько людей её поставили. */
export function ReactionChip({ emoji, count, mine, tone, onPress }: ReactionChipProps) {
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
        disabled={!onPress}
        hitSlop={4}
        onPress={onPress}
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
