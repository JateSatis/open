import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  cell: {
    overflow: 'hidden',
  },
  /** Значок удаления — справа под строкой, проявляется свайпом. */
  removeIcon: {
    position: 'absolute',
    right: Spacing.three,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  removeCircle: {
    width: Sizes.swipeReplyIcon,
    height: Sizes.swipeReplyIcon,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  date: {
    width: Sizes.watchLaterDateWidth,
  },
  titles: {
    flex: 1,
    gap: Spacing.half,
  },
  details: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  expandedRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  bubble: {
    flex: 1,
  },
  checkColumn: {
    width: Sizes.selectionCheck,
  },
});
