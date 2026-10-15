import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  circle: {
    width: Sizes.avatarPicker,
    height: Sizes.avatarPicker,
    borderRadius: Radii.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    width: Sizes.avatarPickerCompact,
    height: Sizes.avatarPickerCompact,
    borderRadius: Radii.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
