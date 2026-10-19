import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ReactionBadge, type ShownPerson } from './ReactionBadge';
import { onRowsReset, readRowOffset, rememberRowOffset } from './rowMemory';
import { styles } from './styles';
import type { ReactionsTone } from './tones';

import { useEnclosingHorizontalGestures } from '@/components/HorizontalGestureScope';

/** Сдвиг прокрутки в событиях — чаще не нужно: он лишь запоминается для копии. */
const SCROLL_THROTTLE_MS = 32;

export type MemberReactionRowProps = {
  /** Ключ памяти ряда: сдвиг переживает облачко и достаётся его копии. */
  memoryKey: string;
  /** Реакции в порядке показа: моя первой, дальше по популярности. */
  entries: readonly [string, number][];
  mine: string | null;
  /** Аватары одного-двух поставивших; `null` — под реакцией число. */
  peopleOf: (emoji: string, count: number) => readonly ShownPerson[] | null;
  tone: ReactionsTone;
  /** Тап по значку: снять свою или поставить другую. Нет — значки не нажимаются. */
  onToggle?: (emoji: string) => void;
  /** Живое облачко, но ряд не мой: касание по значку глотается (см. `ReactionBadge`). */
  swallowsTouch: boolean;
  /** Копия облачка: ничего не нажимается и не прокручивается, сдвиг — как у оригинала. */
  frozen: boolean;
};

/**
 * Ряд реакций участников — всегда одна строка. Не влезает в отведённое
 * место — прокручивается вбок; облачко из-за него не шире. Прокрученный ряд
 * возвращается в начало, как только прокрутили сам список (`rowMemory`).
 */
export function MemberReactionRow({
  memoryKey,
  entries,
  mine,
  peopleOf,
  tone,
  onToggle,
  swallowsTouch,
  frozen,
}: MemberReactionRowProps) {
  const enclosing = useEnclosingHorizontalGestures();
  const scrollRef = useRef<ScrollView>(null);
  const [initialOffset] = useState(() => readRowOffset(memoryKey));
  const [scrolled, setScrolled] = useState(initialOffset > 0);
  const [viewWidth, setViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scrollable = viewWidth > 0 && contentWidth > viewWidth;

  // Касание, начатое на прокручиваемом ряду, — ряду: свайп-ответ и листание
  // разделов ждут, пока он откажется. Не прокручивается — не мешает им вовсе.
  const native = useMemo(
    () =>
      Gesture.Native()
        .enabled(scrollable && !frozen)
        .blocksExternalGesture(...enclosing),
    [enclosing, frozen, scrollable],
  );

  // Ряд стал короче (реакцию сняли) — запомненный сдвиг не больше, чем ряд
  // теперь может прокрутиться: иначе копия облачка срезала бы первые значки.
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

  const badges = entries.map(([emoji, count]) => (
    <ReactionBadge
      key={emoji}
      emoji={emoji}
      count={count}
      people={peopleOf(emoji, count)}
      mine={mine === emoji}
      tone={tone}
      onPress={onToggle && !frozen ? () => onToggle(emoji) : undefined}
      swallowsTouch={swallowsTouch && !frozen}
    />
  ));

  // Копия — без прокрутки: сдвиг сразу стоит на месте, а не доезжает после
  // первого кадра, как у `contentOffset`.
  if (frozen) {
    return (
      <View testID="member-reactions" style={styles.rowClip}>
        <View style={[styles.rowContent, { transform: [{ translateX: -initialOffset }] }]}>
          {badges}
        </View>
      </View>
    );
  }

  return (
    <GestureDetector gesture={native}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        ref={scrollRef}
        testID="member-reactions"
        horizontal
        scrollEnabled={scrollable}
        showsHorizontalScrollIndicator={false}
        contentOffset={initialOffset > 0 ? { x: initialOffset, y: 0 } : undefined}
        onScroll={onScroll}
        scrollEventThrottle={SCROLL_THROTTLE_MS}
        onLayout={(event: LayoutChangeEvent) => setViewWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={setContentWidth}
        contentContainerStyle={styles.rowContent}
      >
        {badges}
      </ScrollView>
    </GestureDetector>
  );
}
