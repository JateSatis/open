import type { ThemeColor } from '@/theme';

/** В каком облачке стоят реакции: в своём (на `primary`) или в чужом. */
export type ReactionsTone = 'own' | 'other';

/** Круг реакции участников; моя выделена подложкой. */
export function chipBackground(tone: ReactionsTone, mine: boolean): ThemeColor {
  if (tone === 'own') return mine ? 'reactionChipMineOnPrimary' : 'reactionChipOnPrimary';

  return mine ? 'primary' : 'reactionChip';
}

type LabelColors = { background: ThemeColor; text: ThemeColor };

/**
 * Число под кругом — плашкой цвета облачка: наезжая на край круга, оно
 * читается и на моей (залитой) реакции. Тот же цвет — обводка аватаров.
 */
export function labelColors(tone: ReactionsTone): LabelColors {
  return tone === 'own'
    ? { background: 'primary', text: 'primaryText' }
    : { background: 'backgroundElement', text: 'textSecondary' };
}

type VisitorColors = { text: ThemeColor; mine: ThemeColor };

export function visitorColors(tone: ReactionsTone): VisitorColors {
  return tone === 'own'
    ? { text: 'reactionVisitorsOnPrimary', mine: 'reactionVisitorMineOnPrimary' }
    : { text: 'textSecondary', mine: 'reactionVisitorMine' };
}
