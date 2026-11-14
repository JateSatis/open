import type {
  HistoryCoverage,
  HistoryItem,
  HistoryPosition,
  HistorySyncCursor,
} from '@/api/historyWindow';

export type ReadingPlace = HistoryPosition & {
  key: string;
  offset: number;
  messageId?: string;
  itemId?: string | null;
};
export type Piece = {
  coverage: HistoryCoverage;
  syncCursor: HistorySyncCursor;
  items: HistoryItem[];
};
export type StoredPiece = Piece & { id: number };
export type Scope = { reader: string; chat: string };

export const compare = (a: HistoryPosition, b: HistoryPosition) =>
  a.seq - b.seq || a.position - b.position;

// SQL positions are discrete 0..99. -1 and 100 are seek sentinels.
function edge(b: NonNullable<HistoryCoverage['lower']>, lower: boolean) {
  return BigInt(b.seq) * 100n + BigInt(b.position + (b.inclusive ? 0 : lower ? 1 : -1));
}
function leftOf(a: HistoryCoverage, b: HistoryCoverage) {
  return !!a.upper && !!b.lower && edge(a.upper, false) < edge(b.lower, true);
}

export function uncovered(old: HistoryCoverage, covered: HistoryCoverage): HistoryCoverage[] {
  if (!overlaps(old, covered)) return [old];
  const outside: HistoryCoverage[] = [];
  if (covered.lower && (!old.lower || edge(old.lower, true) < edge(covered.lower, true))) {
    outside.push({
      lower: old.lower,
      upper: { ...covered.lower, inclusive: !covered.lower.inclusive },
    });
  }
  if (covered.upper && (!old.upper || edge(old.upper, false) > edge(covered.upper, false))) {
    outside.push({
      lower: { ...covered.upper, inclusive: !covered.upper.inclusive },
      upper: old.upper,
    });
  }
  return outside;
}

export function overlaps(a: HistoryCoverage, b: HistoryCoverage) {
  return !leftOf(a, b) && !leftOf(b, a);
}

export function contains(coverage: HistoryCoverage, p: HistoryPosition) {
  const point = { ...p, inclusive: true };
  return overlaps(coverage, { lower: point, upper: point });
}

/** Choose a single connected component. A hole must never look like adjacent messages. */
export function connected<T extends { coverage: HistoryCoverage }>(
  pieces: T[],
  place: ReadingPlace | null,
) {
  const sorted = [...pieces].sort((a, b) => {
    const x = a.coverage.lower,
      y = b.coverage.lower;
    return x && y ? compare(x, y) : x ? 1 : y ? -1 : 0;
  });
  const groups: T[][] = [];
  for (const piece of sorted) {
    const group = groups.at(-1);
    const upper = group?.at(-1)?.coverage.upper,
      lower = piece.coverage.lower;
    if (group && upper && lower && edge(upper, false) + 1n >= edge(lower, true)) group.push(piece);
    else groups.push([piece]);
  }
  if (place) {
    const near = groups.find((group) => {
      const upper = group.at(-1)!.coverage.upper;
      return !upper || compare(upper, place) >= 0;
    });
    if (near) return near;
  }
  return groups.at(-1) ?? [];
}

export function boundaryCursor(coverage: HistoryCoverage, direction: 'before' | 'after') {
  const b = direction === 'before' ? coverage.lower : coverage.upper;
  if (!b) return null;
  return { seq: b.seq, position: b.position + (b.inclusive ? 0 : direction === 'before' ? 1 : -1) };
}
