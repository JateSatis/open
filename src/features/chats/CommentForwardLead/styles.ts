import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  lead: {
    gap: Spacing.one,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  labelText: {
    flexShrink: 1,
  },
  /** Автор комментария — сразу над его текстом, как имя в облачке. */
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    paddingTop: Spacing.one,
  },
  /** Цитата попа — как цитата сообщения (`ReplyQuote`), с вертикальной обложкой. */
  popQuote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.sm,
    overflow: 'hidden',
  },
  popQuoteAccent: {
    alignSelf: 'stretch',
    width: Sizes.quoteAccent,
    marginVertical: -Spacing.one,
  },
  popQuoteCover: {
    width: Sizes.popQuoteCoverWidth,
    height: Sizes.popQuoteCoverHeight,
    borderRadius: Radii.sm,
  },
  popQuoteBody: {
    flexShrink: 1,
    minHeight: Typography.smallBold.lineHeight + Typography.small.lineHeight,
    justifyContent: 'center',
  },
  popQuoteDeleted: {
    fontStyle: 'italic',
  },
});
