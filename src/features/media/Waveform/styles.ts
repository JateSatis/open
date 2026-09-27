import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

/** Ширина столбика и зазор: 50 столбиков укладываются в ~150 точек облачка. */
export const BAR_WIDTH = Spacing.half;
export const BAR_GAP = Spacing.half / 2;
/** Самый тихий столбик всё равно виден — иначе пауза выглядела бы обрывом волны. */
export const MIN_BAR_HEIGHT = Spacing.half;
export const WAVEFORM_HEIGHT = Spacing.four;

export const styles = StyleSheet.create({
  container: {
    height: WAVEFORM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: Radii.full,
  },
});
