import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  /** Шторка — справа, на всю высоту окна; слева видна затемнённая переписка. */
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
  },
  column: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  /** Корень треда — на фоне островка, как корень в треде комментариев. */
  chatThreadRoot: {
    marginHorizontal: -Spacing.two,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    borderRadius: Radii.lg,
  },
  action: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hidden: {
    display: 'none',
  },
});
