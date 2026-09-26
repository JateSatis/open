import { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { BAR_GAP, BAR_WIDTH, MIN_BAR_HEIGHT, styles, WAVEFORM_HEIGHT } from './styles';

import { WAVEFORM_BARS, WAVEFORM_MAX } from '@/features/media/lib/waveform';

export type WaveformProps = {
  /** Столбики 0..31 из `attachments.waveform`. `null` — волны нет, рисуется ровная дорожка. */
  bars: readonly number[] | null;
  /** Сколько проиграно, 0..1: столько столбиков закрашено. */
  progress: number;
  playedColor: string;
  restColor: string;
  /** Тап или протяжка по волне. Без обработчика волна только показывает. */
  onSeek?: (fraction: number) => void;
  accessibilityValue?: string;
};

/** Ширина волны не зависит от записи: облачко одного размера до и после загрузки. */
export const WAVEFORM_WIDTH = WAVEFORM_BARS * BAR_WIDTH + (WAVEFORM_BARS - 1) * BAR_GAP;

/** Ровная дорожка вместо волны, которой нет: выдумывать форму нельзя. */
const FLAT: readonly number[] = Array.from({ length: WAVEFORM_BARS }, () => 0);

function barHeight(value: number): number {
  const unit = Math.min(1, Math.max(0, value / WAVEFORM_MAX));

  return MIN_BAR_HEIGHT + unit * (WAVEFORM_HEIGHT - MIN_BAR_HEIGHT);
}

export function Waveform({
  bars,
  progress,
  playedColor,
  restColor,
  onSeek,
  accessibilityValue,
}: WaveformProps) {
  // Пока палец тянет по волне, закрашивается то место, куда он отпустит.
  const [scrub, setScrub] = useState<number | null>(null);
  const values = bars && bars.length > 0 ? bars : FLAT;
  const shown = scrub ?? progress;
  const playedBars = Math.round(shown * values.length);

  const fractionAt = (x: number) => Math.min(1, Math.max(0, x / WAVEFORM_WIDTH));

  const seekTo = (x: number) => onSeek?.(fractionAt(x));

  // Протяжка включается только горизонтальным движением: вертикальный
  // жест остаётся списку сообщений.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(onSeek !== undefined)
    .activeOffsetX([-BAR_WIDTH * 4, BAR_WIDTH * 4])
    .failOffsetY([-BAR_WIDTH * 4, BAR_WIDTH * 4])
    .onUpdate((event) => setScrub(fractionAt(event.x)))
    .onEnd((event) => seekTo(event.x))
    .onFinalize(() => setScrub(null));

  const tap = Gesture.Tap()
    .runOnJS(true)
    .enabled(onSeek !== undefined)
    .onEnd((event, success) => {
      if (success) seekTo(event.x);
    });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        testID="waveform"
        accessible={onSeek !== undefined}
        accessibilityRole="adjustable"
        accessibilityLabel="Перемотка голосового сообщения"
        accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const step = event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;

          onSeek?.(Math.min(1, Math.max(0, progress + step)));
        }}
        style={[styles.container, { width: WAVEFORM_WIDTH }]}
      >
        {values.map((value, index) => (
          <View
            // Столбики не переставляются: позиция и есть идентичность.
            key={index}
            testID={index < playedBars ? 'waveform-bar-played' : 'waveform-bar'}
            style={[
              styles.bar,
              {
                height: barHeight(value),
                backgroundColor: index < playedBars ? playedColor : restColor,
              },
            ]}
          />
        ))}
      </View>
    </GestureDetector>
  );
}
