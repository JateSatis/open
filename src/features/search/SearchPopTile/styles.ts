import { StyleSheet } from 'react-native';

import { Radii, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  tile: {
    gap: Spacing.one,
  },
  cover: {
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  // Две строки всегда: короткое название не поднимает строку канала, и плитки
  // в ряду стоят ровно.
  title: {
    height: Typography.small.lineHeight * 2,
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  channelTitle: {
    flex: 1,
  },
});
