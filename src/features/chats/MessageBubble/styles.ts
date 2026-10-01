import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
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
  /** Альбом и, если облачка нет, реакции под ним. */
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
  },
  /** Содержимое облачка над низом — шириной по самому широкому, а не по облачку. */
  content: {
    alignSelf: 'flex-start',
    gap: Spacing.one,
  },
  /** Строка низа облачка: кнопка комментариев у внешнего края, время справа. */
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  footerShrink: {
    flexShrink: 1,
  },
  footerSpacer: {
    flexGrow: 1,
  },
  /** Время и кнопка комментариев поверх медиа без подписи — у нижнего края мозаики. */
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
  /** Под альбомом без облачка: реакции и кнопка комментариев у правого края. */
  bareFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  attachmentSlot: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
});
