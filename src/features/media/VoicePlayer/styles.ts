import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const BUTTON_SIZE = 40;

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: Spacing.half,
  },
});
