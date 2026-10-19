import { StyleSheet } from 'react-native';

import { Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Spacing.three,
    zIndex: 1,
  },
  back: {
    width: Sizes.headerButton,
    height: Sizes.headerButton,
    marginLeft: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Название — с той же линии, что у нативной шапки: стрелка и поле до него.
  title: {
    flex: 1,
    minWidth: 0,
    marginLeft: Sizes.headerTitleLeft - Sizes.headerButton - Spacing.one,
  },
  titleAlone: {
    marginLeft: Spacing.three,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
