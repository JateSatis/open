import { StyleSheet } from 'react-native';

import { InfoPageSizes, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    minHeight: InfoPageSizes.cardRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  label: {
    flex: 1,
  },
  badge: {
    minWidth: Sizes.segmentBadge,
    height: Sizes.segmentBadge,
    borderRadius: Sizes.segmentBadge / 2,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
