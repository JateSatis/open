import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

const HANDLE_BAR_WIDTH = 36;
const HANDLE_BAR_HEIGHT = 4;

export const styles = StyleSheet.create({
  handle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleBar: {
    width: HANDLE_BAR_WIDTH,
    height: HANDLE_BAR_HEIGHT,
    borderRadius: HANDLE_BAR_HEIGHT / 2,
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.one,
    padding: Spacing.one,
  },
});
