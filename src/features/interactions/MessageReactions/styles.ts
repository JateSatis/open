import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Значки ряда участников вплотную к краю: поля даёт строка облачка. */
  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  /** Копия облачка: ряд без прокрутки, сдвинутый так же, как оригинал. */
  rowClip: {
    overflow: 'hidden',
  },
  /** Значок не сжимается: в копии ряд лежит в обычной строке, а не в прокрутке. */
  badge: {
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeCircle: {
    width: Sizes.reactionBadge,
    height: Sizes.reactionBadge,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Число или аватары — по центру под кругом, наезжая на его нижний край. */
  badgeLabel: {
    height: Sizes.reactionAvatar,
    marginTop: -Sizes.reactionLabelOverlap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  people: {
    flexDirection: 'row',
  },
  personRing: {
    borderRadius: Radii.full,
    borderWidth: Sizes.reactionRing,
    // Обводка рисуется снаружи аватара и не меняет его места под кругом.
    margin: -Sizes.reactionRing,
  },
  personOverlap: {
    marginLeft: -Sizes.reactionAvatarOverlap - Sizes.reactionRing,
  },
  count: {
    minWidth: Sizes.reactionAvatar,
    height: Sizes.reactionAvatar,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.full,
    borderWidth: Sizes.reactionRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Строка зрителей в нижней строке облачка: шириной по реакциям, пока
   * облачку есть куда расти, дальше сжимается и прокручивается.
   */
  visitorFrame: {
    flexDirection: 'row',
    flexShrink: 1,
    minWidth: 0,
  },
  visitorScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  visitorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  visitor: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.sm,
  },
});
