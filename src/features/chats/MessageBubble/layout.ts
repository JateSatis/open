import { Sizes, Spacing } from '@/theme';

/** Зазор между аватаром, облачком и местом круга в строке. */
export const BUBBLE_ROW_GAP = Spacing.two;
/** Аватар слева от чужого облачка. */
export const BUBBLE_AVATAR = Spacing.five;

/**
 * Сколько ширины строки занято рядом с облачком: место круга комментариев и,
 * если есть, аватар — с зазорами. По нему мозаика не вылезает за край.
 */
export function bubbleAsideWidth(withAvatar: boolean): number {
  return Sizes.commentsCircle + BUBBLE_ROW_GAP + (withAvatar ? BUBBLE_AVATAR + BUBBLE_ROW_GAP : 0);
}
