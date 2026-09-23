import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

const HANDLE_BAR_WIDTH = Spacing.five + Spacing.one;
const HANDLE_BAR_HEIGHT = Spacing.one;

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropTouchable: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    overflow: 'hidden',
  },
  handle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  handleBar: {
    width: HANDLE_BAR_WIDTH,
    height: HANDLE_BAR_HEIGHT,
    borderRadius: Radii.full,
  },
  content: {
    flex: 1,
  },
  // Строка ввода не едет вместе с шитом между «половиной» и «весь экран»:
  // она прижата к низу экрана и уходит вниз только вместе с закрытием.
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
