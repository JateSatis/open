import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingTop: Spacing.half,
    paddingBottom: Spacing.two,
  },
  own: {
    justifyContent: 'flex-end',
  },
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  people: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlap: {
    marginLeft: -Sizes.chatThreadAvatarOverlap,
  },
  others: {
    marginLeft: Spacing.one,
  },
  last: {
    flexShrink: 1,
  },
});
