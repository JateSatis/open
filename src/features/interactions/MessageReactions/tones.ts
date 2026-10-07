import type { ThemeColor } from '@/theme';

/** В каком облачке стоят реакции: в своём (на `primary`) или в чужом. */
export type ReactionsTone = 'own' | 'other';

type ChipColors = { background: ThemeColor; text: ThemeColor };

/** Круг реакции участников; моя выделена подложкой. */
export function chipColors(tone: ReactionsTone, mine: boolean): ChipColors {
  if (tone === 'own') {
    return mine
      ? { background: 'reactionChipMineOnPrimary', text: 'primary' }
      : { background: 'reactionChipOnPrimary', text: 'primaryText' };
  }

  return mine
    ? { background: 'primary', text: 'primaryText' }
    : { background: 'reactionChip', text: 'primary' };
}

/**
 * Число под кругом — плашкой цвета облачка: наезжая на край круга, оно
 * читается и на моей (залитой) реакции. Тот же цвет — обводка аватаров.
 */
export function labelColors(tone: ReactionsTone): ChipColors {
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
