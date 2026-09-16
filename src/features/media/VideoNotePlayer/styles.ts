import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  circle: {
    overflow: 'hidden',
    borderRadius: Radii.full,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  duration: {
    position: 'absolute',
    bottom: Spacing.two,
    alignSelf: 'center',
  },
});
