import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const RECORD_BUTTON_SIZE = 64;

export const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  // The circle is the mask; the preview inside it is deliberately taller than
  // the circle so a 4:3 sensor frame is cropped rather than letterboxed.
  circle: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
  },
  preview: {
    position: 'absolute',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  recordButton: {
    width: RECORD_BUTTON_SIZE,
    height: RECORD_BUTTON_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
});
