// Как выглядит подсветка кластера: лидер реакций, заметность по их числу и
// стиль — цвет заливки и силуэтов. Лидер считает база (колонка
// `fragment_clusters.dominant_emoji`, миграция
// `20261027110000_fragment_cluster_dominant.sql`); здесь то же правило — для
// моей реакции, пока база не ответила. Случаи — общие с
// `supabase/tests/fragment_cluster_dominant.sql`.

import type { ReactionCounts } from '@/api/reactionCounts';
import { ALL_REACTIONS } from '@/features/interactions/reactionSet';
import { ClusterLook, ClusterPalette } from '@/theme';

/**
 * Порядок ничьих без прежнего лидера — порядок справочника реакций
 * (`reaction_emojis.position`): клиентский набор идёт в нём же, его сверяет
 * тест набора. Эмодзи вне набора — после всех, по строке, как в базе.
 */
function tieRank(emoji: string): number {
  const index = ALL_REACTIONS.indexOf(emoji);

  return index === -1 ? ALL_REACTIONS.length : index;
}

/**
 * Лидер сводных рядов: эмодзи с наибольшим числом (участники и посетители
 * вместе). Прежний лидер среди максимальных — остаётся, пока соперник не
 * обгонит строго; без него — первый по порядку справочника. Реакций нет — null.
 */
export function dominantReaction(
  rows: readonly ReactionCounts[],
  previous: string | null,
): string | null {
  const totals = new Map<string, number>();

  for (const row of rows) {
    for (const [emoji, count] of Object.entries(row)) {
      totals.set(emoji, (totals.get(emoji) ?? 0) + count);
    }
  }

  let top = 0;

  for (const count of totals.values()) top = Math.max(top, count);

  if (top <= 0) return null;

  const leaders = [...totals].filter(([, count]) => count === top).map(([emoji]) => emoji);

  if (previous !== null && leaders.includes(previous)) return previous;

  return leaders.sort((a, b) => tieRank(a) - tieRank(b) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/** Заметность подсветки, 0…1: логарифм числа реакций с насыщением. */
export function highlightIntensity(reactionsCount: number): number {
  if (reactionsCount <= 0) return 0;

  return Math.min(1, Math.log1p(reactionsCount) / Math.log1p(ClusterLook.saturateAt));
}

export type ClusterTone = {
  /** Цвет заливки с альфой. */
  fill: string;
  /** Силуэты фоном: эмодзи и её цвет с альфой. Нет реакций — нет и силуэтов. */
  pattern: { emoji: string; color: string } | null;
};

function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

function lerp([from, to]: readonly [number, number], t: number): number {
  return from + (to - from) * t;
}

/**
 * Стиль подсветки кластера. Лидера нет (кластер держится на комментариях) —
 * `neutral`, прежняя заливка без силуэтов. Число реакций меняет только альфу.
 */
export function clusterTone(
  cluster: { dominant: string | null; reactionsCount: number },
  scheme: 'light' | 'dark',
  isOwn: boolean,
  neutral: string,
): ClusterTone {
  if (!cluster.dominant) return { fill: neutral, pattern: null };

  const surface = ClusterPalette[scheme][isOwn ? 'own' : 'foreign'];
  const base = surface.tones[cluster.dominant] ?? surface.tones.other;
  const t = highlightIntensity(cluster.reactionsCount);

  return {
    fill: withAlpha(base, lerp(surface.fill, t)),
    pattern: { emoji: cluster.dominant, color: withAlpha(base, lerp(surface.pattern, t)) },
  };
}
