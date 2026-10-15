import { StyleSheet } from 'react-native';

import { Sizes } from '@/theme';

export const styles = StyleSheet.create({
  rect: {
    position: 'absolute',
  },
  stem: {
    position: 'absolute',
    width: Sizes.selectionHandleStem,
  },
  drop: {
    position: 'absolute',
    width: Sizes.selectionHandle,
    height: Sizes.selectionHandle,
    borderRadius: Sizes.selectionHandle / 2,
  },
});
