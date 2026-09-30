import { StyleSheet } from 'react-native';

import { PICKER_PADDING } from './geometry';

import { Radii, Sizes } from '@/theme';

export const styles = StyleSheet.create({
  picker: {
    position: 'absolute',
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: PICKER_PADDING,
  },
  cell: {
    width: Sizes.reactionCell,
    height: Sizes.reactionCell,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
