import { useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { estimateLineWidth, fitScale, VISITOR_LINE, VISITOR_MIN_SCALE } from './lineScale';
import { readLineMetrics, rememberLineMetrics } from './rowMemory';
import { styles } from './styles';
import { visitorColors, type ReactionsTone } from './tones';

import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { useTheme } from '@/hooks/use-theme';
import { Radii, Typography } from '@/theme';

const APPEAR_MS = 160;

export type VisitorReactionLineProps = {
  /** Ключ памяти: масштаб переживает облачко и достаётся его копии. */
  memoryKey: string;
  /** По популярности. */
  entries: readonly [string, number][];
  /** Моя реакция в этом ряду. */
  mine: string | null;
  tone: ReactionsTone;
};

/**
 * Реакции зрителей — маленькие, строкой по центру под нижней строкой
 * облачка. Не нажимаются: касание проходит облачку, и оно открывает меню.
 * Высота строки постоянна, а масштаб считается от ширины облачка, — поэтому
 * облачко не прыгает, пока строка подбирает размер.
 */
export function VisitorReactionLine({ memoryKey, entries, mine, tone }: VisitorReactionLineProps) {
  const theme = useTheme();
  const colors = visitorColors(tone);
  const labels = entries.map(([emoji, count]) => [emoji, formatViewsCount(count)] as const);
  const [remembered] = useState(() => readLineMetrics(memoryKey));
  const [natural, setNatural] = useState(() => remembered?.natural ?? estimateLineWidth(labels));
  const [available, setAvailable] = useState<number | null>(null);
  // Строку без уменьшения меряет линейка — один раз на набор реакций: замер
  // уменьшенной строки не строго пропорционален масштабу, и пересчёт по нему
  // качал бы ширину облачка туда-сюда.
  const signature = labels.map(([emoji, count]) => emoji + count).join(' ');
  const measuredFor = useRef<string | null>(null);
  const scale = available === null ? (remembered?.scale ?? 1) : fitScale(natural, available);
  // До замера ширины без памяти строка не видна: показалась бы не в своём размере.
  const ready = available !== null || remembered !== undefined;

  const font = {
    fontSize: Typography.caption.fontSize * scale,
    lineHeight: Typography.caption.lineHeight * scale,
  };

  const onFrame = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;

    setAvailable(width);
    rememberLineMetrics(memoryKey, { natural, scale: fitScale(natural, width) });
  };

  const onRuler = (event: LayoutChangeEvent) => {
    if (measuredFor.current === signature) return;

    measuredFor.current = signature;
    const measured = event.nativeEvent.layout.width;

    setNatural(measured);
    if (available !== null) {
      rememberLineMetrics(memoryKey, { natural: measured, scale: fitScale(measured, available) });
    }
  };

  return (
    <Animated.View
      testID="visitor-reactions"
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      pointerEvents="none"
      onLayout={onFrame}
      // Облачко не уже строки в самом мелком виде — иначе ей некуда влезть.
      style={[styles.visitorFrame, { minWidth: natural * VISITOR_MIN_SCALE }]}
    >
      <View style={[styles.visitorRuler, styles.hidden]} importantForAccessibility="no-hide-descendants">
        <View onLayout={onRuler} style={[styles.visitorLine, { gap: VISITOR_LINE.between }]}>
          {labels.map(([emoji, count]) => (
            <View
              key={emoji}
              style={[
                styles.visitor,
                { gap: VISITOR_LINE.inner, paddingHorizontal: VISITOR_LINE.padding },
              ]}
            >
              <Text variant="caption">{emoji}</Text>
              <Text variant="caption">{count}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.visitorCenter, !ready && styles.hidden]}>
        <View style={[styles.visitorLine, { gap: VISITOR_LINE.between * scale }]}>
          {entries.map(([emoji, count], index) => (
            <View
              key={emoji}
              testID={`visitor-reaction-${emoji}`}
              accessible
              accessibilityLabel={`Зрители: ${emoji} ${count}`}
              accessibilityState={{ selected: mine === emoji }}
              style={[
                styles.visitor,
                {
                  gap: VISITOR_LINE.inner * scale,
                  paddingHorizontal: VISITOR_LINE.padding * scale,
                  borderRadius: Radii.sm * scale,
                },
                mine === emoji && { backgroundColor: theme[colors.mine] },
              ]}
            >
              <Text variant="caption" style={font}>
                {emoji}
              </Text>
              <Text variant="caption" color={colors.text} style={font}>
                {labels[index][1]}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}
