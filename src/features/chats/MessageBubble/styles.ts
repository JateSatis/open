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
    // Рядом бывает кружок комментариев: облачко уступает ему, а не выталкивает за край.
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
  /** Цитата и «Переслано от» над мозаикой — с отступами, как у имени автора. */
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
  attachmentSlot: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
  },
});
