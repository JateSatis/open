import type { ThemeColor } from '@/theme';

/** Где стоят реакции: в своём облачке (на `primary`), в чужом или прямо на видео. */
export type ReactionsTone = 'own' | 'other' | 'media';

/** Круг реакции участников; моя выделена подложкой. */
export function chipBackground(tone: ReactionsTone, mine: boolean): ThemeColor {
  if (tone === 'own') return mine ? 'reactionChipMineOnPrimary' : 'reactionChipOnPrimary';
  if (tone === 'media') return mine ? 'primary' : 'mediaScrim';

  return mine ? 'primary' : 'reactionChip';
}

type LabelColors = { background: ThemeColor; text: ThemeColor };

/**
 * Число под кругом — плашкой цвета облачка: наезжая на край круга, оно
 * читается и на моей (залитой) реакции. Тот же цвет — обводка аватаров.
 */
export function labelColors(tone: ReactionsTone): LabelColors {
  if (tone === 'media') return { background: 'mediaScrim', text: 'textOnMedia' };

  return tone === 'own'
    ? { background: 'primary', text: 'primaryText' }
    : { background: 'backgroundElement', text: 'textSecondary' };
}

type VisitorColors = { text: ThemeColor; mine: ThemeColor };

export function visitorColors(tone: ReactionsTone): VisitorColors {
  return tone !== 'other'
    ? { text: 'reactionVisitorsOnPrimary', mine: 'reactionVisitorMineOnPrimary' }
    : { text: 'textSecondary', mine: 'reactionVisitorMine' };
}
