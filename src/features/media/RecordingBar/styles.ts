import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const DOT_SIZE = Spacing.two + Spacing.half;
/** Живые уровни: последние две секунды записи, короткая полоска у таймера. */
export const LIVE_BAR_WIDTH = Spacing.half;
export const LIVE_HEIGHT = Spacing.four;

export const styles = StyleSheet.create({
  bar: {
    // Чуть шире поля по вертикали: иначе из-под полосы выглядывает
    // скруглённая граница поля ввода.
    position: 'absolute',
    top: -Spacing.one,
    right: 0,
    bottom: -Spacing.one,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: Radii.full,
  },
  timer: {
    fontVariant: ['tabular-nums'],
  },
  live: {
    height: LIVE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  liveBar: {
    width: LIVE_BAR_WIDTH,
    borderRadius: Radii.full,
  },
  hint: {
    flex: 1,
    alignItems: 'flex-end',
  },
  hintClip: {
    flex: 1,
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
});
