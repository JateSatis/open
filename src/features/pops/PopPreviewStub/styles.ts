import { StyleSheet } from 'react-native';

import { Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  back: {
    width: Sizes.popSideButton,
    height: Sizes.popSideButton,
    marginLeft: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  text: {
    textAlign: 'center',
  },
});
