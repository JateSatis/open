import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const PROGRESS_HEIGHT = 4;
export const BUTTON_SIZE = 40;

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: Spacing.two,
  },
  track: {
    height: PROGRESS_HEIGHT,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  progress: {
    height: PROGRESS_HEIGHT,
    borderRadius: Radii.full,
  },
});
