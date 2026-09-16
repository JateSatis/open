import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const BUTTON_SIZE = 56;
export const LEVEL_BAR_HEIGHT = 4;

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
  },
  body: {
    flex: 1,
    gap: Spacing.two,
  },
  levelTrack: {
    height: LEVEL_BAR_HEIGHT,
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  level: {
    height: LEVEL_BAR_HEIGHT,
    borderRadius: Radii.full,
  },
  recordButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
