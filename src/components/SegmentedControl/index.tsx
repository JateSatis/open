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
};

/**
 * Сегментированный контрол над пейджером. Свой, а не нативный из `@expo/ui`:
 * бегунку нужно следовать за жестом, а не только за выбором.
 */
export function SegmentedControl({
  segments,
  position,
  selectedIndex,
  onSelect,
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
      {segments.map((label, index) => (
        <Pressable
          key={label}
          testID={`segment-${index}`}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: index === selectedIndex }}
          onPress={() => onSelect(index)}
          style={styles.segment}
        >
          <Text variant={index === selectedIndex ? 'smallBold' : 'small'}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
