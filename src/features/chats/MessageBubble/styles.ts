import { StyleSheet } from 'react-native';

import { BUBBLE_ROW_GAP } from './layout';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: BUBBLE_ROW_GAP,
    marginBottom: Spacing.two,
  },
  own: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    flexShrink: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.lg,
    gap: Spacing.one,
  },
  wide: {
    maxWidth: `${Sizes.postBubbleShare * 100}%`,
  },
  mediaColumn: {
    gap: Spacing.half,
  },
  /** Ширину задаёт мозаика; скругление облачка обрезает её углы. */
  mediaBubble: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  mediaAuthor: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  /** Цитата над мозаикой — с отступами, как у имени автора. */
  mediaAnnotations: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  mediaAnnotationsOwn: {
    paddingTop: Spacing.two,
  },
  caption: {
    paddingTop: Spacing.one + Spacing.half,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  /** Реакции под мозаикой без подписи — внутри облачка, с отступами, как у подписи. */
  mediaReactions: {
    padding: Spacing.two,
    gap: Spacing.one,
  },
  /** Содержимое облачка над низом — шириной по самому широкому, а не по облачку. */
  content: {
    alignSelf: 'flex-start',
    gap: Spacing.one,
  },
  /** Строка низа облачка: время и статус слева, просмотры справа. */
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  /**
   * Место крупного ряда реакций: растягивает облачко под ряд, пока оно не
   * упрётся в свой предел, дальше сжимается — и ряд прокручивается вбок.
   */
  footerReactions: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  footerSpacer: {
    flexGrow: 1,
  },
  /** Время и просмотры поверх медиа без подписи — у нижнего края мозаики. */
  mediaOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.one + Spacing.half,
    gap: Spacing.one,
  },
  /** Место круга комментариев сбоку: прижато к низу строки — к низу облачка. */
  aside: {
    width: Sizes.commentsCircle,
    alignSelf: 'flex-end',
  },
  attachmentSlot: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
});
