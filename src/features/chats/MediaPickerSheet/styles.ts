import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const HANDLE_BAR_WIDTH = Spacing.five + Spacing.one;
const HANDLE_BAR_HEIGHT = Spacing.one;

export const styles = StyleSheet.create({
  handle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
  },
  handleBar: {
    width: HANDLE_BAR_WIDTH,
    height: HANDLE_BAR_HEIGHT,
    borderRadius: Radii.full,
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.one,
    padding: Spacing.one,
  },
});
