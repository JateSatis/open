import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { onRowsReset, readRowOffset, rememberRowOffset } from './rowMemory';
import { styles } from './styles';
import { visitorColors, type ReactionsTone } from './tones';

import { useEnclosingHorizontalGestures } from '@/components/HorizontalGestureScope';
import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { useTheme } from '@/hooks/use-theme';
import { Typography } from '@/theme';

const APPEAR_MS = 160;
/** Сдвиг прокрутки в событиях — чаще не нужно: он лишь запоминается для копии. */
const SCROLL_THROTTLE_MS = 32;

export type VisitorReactionLineProps = {
  /** Ключ памяти: сдвиг переживает облачко и достаётся его копии. */
  memoryKey: string;
  /** По популярности. */
  entries: readonly [string, number][];
  /** Моя реакция в этом ряду. */
  mine: string | null;
  tone: ReactionsTone;
  /** Копия облачка: не прокручивается, сдвиг — как у оригинала. */
  frozen: boolean;
};

/**
 * Реакции зрителей — маленькие, в нижней строке облачка между временем и
 * просмотрами. Размер постоянный: строка расширяет облачко до его предела,
 * дальше прокручивается вбок, а время и просмотры стоят на месте. Не
 * нажимаются: тап проходит облачку, и оно открывает меню.
 */
export function VisitorReactionLine({
  memoryKey,
  entries,
  mine,
  tone,
  frozen,
}: VisitorReactionLineProps) {
  const theme = useTheme();
  const colors = visitorColors(tone);
  const enclosing = useEnclosingHorizontalGestures();
  const scrollRef = useRef<ScrollView>(null);
  const [initialOffset] = useState(() => readRowOffset(memoryKey));
  const [scrolled, setScrolled] = useState(initialOffset > 0);
  const [viewWidth, setViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scrollable = viewWidth > 0 && contentWidth > viewWidth;
  // Высота строки — как у времени рядом, и при крупном системном шрифте:
  // строка появляется, а облачко не меняет высоту.
  const { fontScale } = useWindowDimensions();
  const height = { height: Typography.caption.lineHeight * fontScale };

  // Касание, начатое на прокручиваемой строке, — ей: свайп-ответ ждёт, пока
  // она откажется. Не прокручивается — не мешает ему вовсе.
  const native = useMemo(
    () =>
      Gesture.Native()
        .enabled(scrollable && !frozen)
        .blocksExternalGesture(...enclosing),
    [enclosing, frozen, scrollable],
  );

  // Строка стала короче — запомненный сдвиг не больше возможного: иначе
  // копия облачка срезала бы первые реакции.
  useEffect(() => {
    if (frozen || viewWidth === 0) return;

    const max = Math.max(0, contentWidth - viewWidth);

    if (readRowOffset(memoryKey) > max) rememberRowOffset(memoryKey, max);
  }, [contentWidth, frozen, memoryKey, viewWidth]);

  useEffect(() => {
    if (!scrolled || frozen) return;

    return onRowsReset(() => {
      scrollRef.current?.scrollTo({ x: 0, animated: true });
      rememberRowOffset(memoryKey, 0);
      setScrolled(false);
    });
  }, [frozen, memoryKey, scrolled]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = Math.max(0, event.nativeEvent.contentOffset.x);

    rememberRowOffset(memoryKey, x);
    if (x > 0 !== scrolled) setScrolled(x > 0);
  };

  const items = entries.map(([emoji, count]) => (
    <View
      key={emoji}
      testID={`visitor-reaction-${emoji}`}
      accessible
      accessibilityLabel={`Зрители: ${emoji} ${count}`}
      accessibilityState={{ selected: mine === emoji }}
      style={[styles.visitor, mine === emoji && { backgroundColor: theme[colors.mine] }]}
    >
      <Text variant="caption">{emoji}</Text>
      <Text variant="caption" color={colors.text}>
        {formatViewsCount(count)}
      </Text>
    </View>
  ));

  return (
    <Animated.View
      testID="visitor-reactions"
      entering={FadeIn.duration(APPEAR_MS)}
      exiting={FadeOut.duration(APPEAR_MS)}
      style={[styles.visitorFrame, height]}
    >
      {frozen ? (
        // Копия — без прокрутки: сдвиг сразу на месте, а не доезжает после
        // первого кадра, как у `contentOffset`.
        <View style={styles.rowClip} pointerEvents="none">
          <View style={[styles.visitorLine, { transform: [{ translateX: -initialOffset }] }]}>
            {items}
          </View>
        </View>
      ) : (
        <GestureDetector gesture={native}>
          <ScrollView
            ref={scrollRef}
            horizontal
            // Не прокручивается — касание целиком облачку.
            pointerEvents={scrollable ? 'auto' : 'none'}
            scrollEnabled={scrollable}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentOffset={initialOffset > 0 ? { x: initialOffset, y: 0 } : undefined}
            onScroll={onScroll}
            scrollEventThrottle={SCROLL_THROTTLE_MS}
            onLayout={(event: LayoutChangeEvent) => setViewWidth(event.nativeEvent.layout.width)}
            onContentSizeChange={setContentWidth}
            style={styles.visitorScroll}
            contentContainerStyle={styles.visitorLine}
          >
            {items}
          </ScrollView>
        </GestureDetector>
      )}
    </Animated.View>
  );
}
