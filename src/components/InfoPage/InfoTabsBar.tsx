import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { InfoTab } from './types';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Radii, Spacing } from '@/theme';

export type InfoTabsBarProps = {
  tabs: InfoTab[];
  index: number;
  /** Позиция пейджера: дробная — между вкладками; таблетка едет за ней. */
  position: SharedValue<number>;
  onSelect: (index: number) => void;
};

/**
 * Полоса вкладок: прокручивается, если не влезает, выбранная — таблетка
 * акцентного цвета. Таблетка едет за пальцем, листающим содержимое, а полоса
 * докручивается, чтобы выбранная была видна.
 */
export function InfoTabsBar({ tabs, index, position, onSelect }: InfoTabsBarProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<(LayoutRectangle | undefined)[]>([]);
  const [barWidth, setBarWidth] = useState(0);
  const measured = layouts.length === tabs.length && layouts.every(Boolean);

  useEffect(() => {
    const layout = layouts[index];

    if (!layout || barWidth === 0) return;

    scrollRef.current?.scrollTo({
      x: Math.max(0, layout.x + layout.width / 2 - barWidth / 2),
      animated: true,
    });
  }, [barWidth, index, layouts]);

  // Точки таблетки — заранее, на JS: в worklet уходят готовые массивы.
  const stops = layouts.map((_, at) => at);
  const xs = layouts.map((layout) => layout?.x ?? 0);
  const widths = layouts.map((layout) => layout?.width ?? 0);

  const pillStyle = useAnimatedStyle(() => {
    if (!measured) return { opacity: 0 };

    if (stops.length === 1) {
      return { opacity: 1, width: widths[0], transform: [{ translateX: xs[0] }] };
    }

    return {
      opacity: 1,
      width: interpolate(position.value, stops, widths, 'clamp'),
      transform: [{ translateX: interpolate(position.value, stops, xs, 'clamp') }],
    };
  });

  return (
    <View
      style={[styles.bar, { backgroundColor: theme.background }]}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { backgroundColor: theme.primary }, pillStyle]}
        />
        {tabs.map((tab, at) => (
          <Pressable
            key={tab.key}
            testID={`info-tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: at === index }}
            accessibilityLabel={tab.title}
            onPress={() => onSelect(at)}
            onLayout={(event) => {
              const layout = event.nativeEvent.layout;

              setLayouts((current) => {
                const next = current.slice(0, tabs.length);
                next[at] = layout;
                return next;
              });
            }}
            style={styles.tab}
          >
            <Text variant="smallBold" color={at === index ? 'primaryText' : 'textSecondary'}>
              {tab.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: InfoPageSizes.tabsHeight,
    justifyContent: 'center',
  },
  content: {
    height: InfoPageSizes.tabsHeight,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
  },
  pill: {
    position: 'absolute',
    left: 0,
    top: (InfoPageSizes.tabsHeight - InfoPageSizes.tabPillHeight) / 2,
    height: InfoPageSizes.tabPillHeight,
    borderRadius: Radii.full,
  },
  tab: {
    height: InfoPageSizes.tabPillHeight,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
