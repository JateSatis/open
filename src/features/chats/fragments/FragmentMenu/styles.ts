import { StyleSheet } from 'react-native';

import { Radii, Shadows, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /** Прозрачная подложка вокруг выделения: тап мимо него снимает выделение. */
  scrim: {
    position: 'absolute',
  },
  menu: {
    position: 'absolute',
    height: Sizes.fragmentCommentButton,
  },
  /** Блок реакций — у левого края меню; раскрытый растёт вниз. */
  picker: {
    left: 0,
    top: 0,
    ...Shadows.floating,
  },
  /** «Скрыть от зрителей» — слева от комментария. */
  hide: {
    position: 'absolute',
    right: Sizes.fragmentCommentButton + Spacing.two,
    top: 0,
    width: Sizes.fragmentCommentButton,
    height: Sizes.fragmentCommentButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.floating,
  },
  /** Зритель выделил скрытое: вместо реакций — почему нельзя. */
  blocked: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: Sizes.fragmentCommentButton,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    ...Shadows.floating,
  },
  comment: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: Sizes.fragmentCommentButton,
    height: Sizes.fragmentCommentButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.floating,
  },
});
