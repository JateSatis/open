import { StyleSheet } from 'react-native';

import { Radii, Sizes } from '@/theme';

export const styles = StyleSheet.create({
  check: {
    borderRadius: Radii.full,
    borderWidth: Sizes.selectionCheckBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
