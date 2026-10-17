import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Как у строки чата: под поиском «Заявки» встают на том же расстоянии,
    // что без них первый чат.
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
  },
  badge: {
    minWidth: Spacing.four,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    alignItems: 'center',
  },
});
