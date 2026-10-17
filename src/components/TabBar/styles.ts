import { StyleSheet } from 'react-native';

import { TabBarSizes } from '@/theme';

export const styles = StyleSheet.create({
  /** Поверх экрана у нижнего края: содержимое доходит до низа и видно под дымкой. */
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    paddingTop: TabBarSizes.fadeTop,
  },
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: TabBarSizes.labelGap,
  },
});
