import type { ThemeColor } from '@/theme';

/**
 * Где стоит блок: в своём облачке (на `primary`), в чужом или без облачка —
 * под альбомом без подписи, на фоне чата.
 */
export type ReactionsTone = 'own' | 'other' | 'bare';

type ChipColors = { background: ThemeColor; text: ThemeColor };

export function chipColors(tone: ReactionsTone, mine: boolean): ChipColors {
  if (tone === 'own') {
    return mine
      ? { background: 'reactionChipMineOnPrimary', text: 'primary' }
      : { background: 'reactionChipOnPrimary', text: 'primaryText' };
  }

  if (mine) return { background: 'primary', text: 'primaryText' };

  return tone === 'bare'
    ? { background: 'backgroundElement', text: 'text' }
    : { background: 'reactionChip', text: 'primary' };
}

type VisitorColors = { text: ThemeColor; mine: ThemeColor };

export function visitorColors(tone: ReactionsTone): VisitorColors {
  return tone === 'own'
    ? { text: 'reactionVisitorsOnPrimary', mine: 'reactionVisitorMineOnPrimary' }
    : { text: 'textSecondary', mine: 'reactionVisitorMine' };
}
