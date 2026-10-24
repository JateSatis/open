import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  lead: {
    minWidth: Sizes.savedLeadMinWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  source: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  sourceText: {
    flexShrink: 1,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.one,
    maxWidth: '50%',
  },
  tag: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Radii.sm,
  },
});
