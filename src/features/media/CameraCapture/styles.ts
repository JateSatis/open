import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const SHUTTER_SIZE = 72;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  preview: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: Radii.full,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
});
