import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  block: {
    gap: Spacing.one,
  },
  /** Под альбомом без подписи облачка нет — ряды стоят на фоне чата, с отступом от мозаики. */
  bare: {
    paddingTop: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    height: Sizes.reactionChip,
    minWidth: Sizes.reactionChip,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  visitors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.one,
  },
  visitor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.sm,
  },
});
