import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  photo: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  busy: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
