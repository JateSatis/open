import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  tabs: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pages: {
    flex: 1,
  },
  /** Обе вкладки — друг на друге: неактивная невидима, но сохраняет прокрутку. */
  page: {
    ...StyleSheet.absoluteFill,
  },
  hidden: {
    opacity: 0,
  },
});
