import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  add: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  addLabel: {
    textAlign: 'center',
  },
  retry: {
    width: Sizes.popEditorButton,
    height: Sizes.popEditorButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    padding: Spacing.four,
  },
  footer: {
    padding: Spacing.three,
  },
});
