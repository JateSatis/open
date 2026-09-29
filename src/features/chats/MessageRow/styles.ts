import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    // Подсветка и фон выбранного — на всю ширину экрана, за полями списка.
    marginHorizontal: -Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flex: 1,
  },
  lifted: {
    opacity: 0,
  },
  selectable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mark: {
    width: Sizes.selectionMark,
    height: Sizes.selectionMark,
    borderRadius: Radii.full,
    borderWidth: Spacing.half,
    alignItems: 'center',
    justifyContent: 'center',
    // Кружок стоит против нижнего края облачка, а не посередине высокой строки.
    alignSelf: 'flex-end',
    marginBottom: Spacing.two + Spacing.one,
  },
  markHidden: {
    opacity: 0,
  },
});
