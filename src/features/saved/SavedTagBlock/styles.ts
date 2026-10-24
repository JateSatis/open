import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

/** Отступ блока — как у полосы реакций. */
export const TAG_BLOCK_PADDING = Spacing.one;

export const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  /** Чип ниже ячейки реакции: полоса свёрнутого блока — той же высоты. */
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: TAG_BLOCK_PADDING + (Sizes.reactionCell - Spacing.five) / 2,
  },
  lead: {
    height: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  expand: {
    height: Spacing.five,
    justifyContent: 'center',
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
