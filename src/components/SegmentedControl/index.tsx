import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type SegmentedControlProps = {
  segments: readonly string[];
  /**
   * Позиция в сегментах: 0 — первый, дробная — между соседними. Бегунок
   * привязан к ней напрямую, поэтому едет за пальцем, листающим пейджер.
   */
  position: SharedValue<number>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /**
   * Число справа от названия сегмента — например, непрочитанное в разделе.
   * Ноль и отсутствие — без пилюли.
   */
  badges?: readonly (number | null | undefined)[];
};

/** Больше — «99+»: дальше число ничего не добавляет. */
const BADGE_MAX = 99;

/**
 * Сегментированный контрол над пейджером. Свой, а не нативный из `@expo/ui`:
 * бегунку нужно следовать за жестом, а не только за выбором.
 */
export function SegmentedControl({
  segments,
  position,
  selectedIndex,
  onSelect,
  badges,
}: SegmentedControlProps) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = Math.max(0, (trackWidth - Spacing.half * 2) / segments.length);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.get() * segmentWidth }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}
    >
      <Animated.View
        style={[
          styles.indicator,
          { width: segmentWidth, backgroundColor: theme.segmentIndicator },
          indicatorStyle,
        ]}
      />
      {segments.map((label, index) => {
        const badge = badges?.[index] ?? 0;

        return (
          <Pressable
            key={label}
            testID={`segment-${index}`}
            accessibilityRole="tab"
            accessibilityLabel={badge > 0 ? `${label}, непрочитанных: ${badge}` : label}
            accessibilityState={{ selected: index === selectedIndex }}
            onPress={() => onSelect(index)}
            style={styles.segment}
          >
            <Text variant={index === selectedIndex ? 'smallBold' : 'small'}>{label}</Text>
            {badge > 0 ? (
              <View
                testID={`segment-badge-${index}`}
                style={[styles.badge, { backgroundColor: theme.primary }]}
              >
                <Text variant="captionBold" color="primaryText">
                  {badge > BADGE_MAX ? `${BADGE_MAX}+` : badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
