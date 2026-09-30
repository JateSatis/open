import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { styles } from './styles';
import { visitorColors, type ReactionsTone } from './tones';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

const APPEAR_MS = 160;

export type VisitorReactionsProps = {
  entries: [string, number][];
  /** Моя реакция в этом ряду. */
  mine: string | null;
  tone: ReactionsTone;
  /** Без обработчика ряд не нажимается: я участник или это копия облачка в меню. */
  onPress?: (emoji: string) => void;
};

/**
 * Реакции посетителей — одна тихая строка под чипами участников, с явной
 * меткой: это зрители, а не собеседники.
 */
export function VisitorReactions({ entries, mine, tone, onPress }: VisitorReactionsProps) {
  const theme = useTheme();
  const colors = visitorColors(tone);

  return (
    <Animated.View
      testID="visitor-reactions"
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      layout={LinearTransition.duration(APPEAR_MS)}
      style={styles.visitors}
    >
      <Text variant="caption" color={colors.text}>
        зрители
      </Text>

      {entries.map(([emoji, count], index) => (
        <View key={emoji} style={styles.visitors}>
          {index > 0 ? (
            <Text variant="caption" color={colors.text}>
              ·
            </Text>
          ) : null}
          <Pressable
            testID={`visitor-reaction-${emoji}`}
            accessibilityRole="button"
            accessibilityLabel={`Зрители: ${emoji} ${count}`}
            accessibilityState={{ selected: mine === emoji, disabled: !onPress }}
            disabled={!onPress}
            hitSlop={6}
            onPress={() => onPress?.(emoji)}
            style={[styles.visitor, mine === emoji && { backgroundColor: theme[colors.mine] }]}
          >
            <Text variant="caption">{emoji}</Text>
            <Text variant="caption" color={colors.text}>
              {count}
            </Text>
          </Pressable>
        </View>
      ))}
    </Animated.View>
  );
}
