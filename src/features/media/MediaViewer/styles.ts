import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

const CLOSE_BUTTON_SIZE = Spacing.five;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  /** Лента страниц: все в ряд, видна одна, сдвигом ленты листается альбом. */
  pager: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  closeWrap: {
    position: 'absolute',
    right: Spacing.three,
  },
  video: {
    flex: 1,
  },
  closeButton: {
    width: CLOSE_BUTTON_SIZE,
    height: CLOSE_BUTTON_SIZE,
    borderRadius: CLOSE_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
