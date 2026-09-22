import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

const CLOSE_BUTTON_SIZE = Spacing.five;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  video: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    right: Spacing.three,
    width: CLOSE_BUTTON_SIZE,
    height: CLOSE_BUTTON_SIZE,
    borderRadius: CLOSE_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
