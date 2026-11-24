import { requestClient } from '@/api/requestClient';
import { getHistoryRange, getHistoryWindow, type HistoryWindowRequest } from '@/api/historyWindow';
import { mergeMessages, type ChatHistory } from '../historyCache';
import { localHistory } from './database';
import {
  boundaryCursor,
  contains,
  overlaps,
  uncovered,
  type Piece,
  type Scope,
  type StoredPiece,
  type ReadingPlace,
} from './segments';
import { reconcile } from './reconcile';

export function projection(scope: Scope, pieces: StoredPiece[]): ChatHistory | undefined {
  if (!pieces.length) return undefined;
  const before = boundaryCursor(pieces[0].coverage, 'before');
  const after = boundaryCursor(pieces[pieces.length - 1].coverage, 'after');
  return mergeMessages(
    {
      items: [],
      nextCursor: before && { ...before, direction: 'before', chatId: scope.chat },
      afterCursor: after && { ...after, direction: 'after', chatId: scope.chat },
    },
    pieces.flatMap((piece) => piece.items.map((item) => item.message)),
    'older',
  );
}

export async function loadPage(scope: Scope, request: HistoryWindowRequest, active: () => boolean, api = requestClient()) {
  const db = localHistory();
  const epoch = db.epoch(scope);
  const expected = db.entries(scope);
  const page = await getHistoryWindow(scope.chat, request, api);
  if (active() && epoch === db.epoch(scope) && page.coverage && page.syncCursor) {
    const replacements: Piece[] = [
      { items: page.items, coverage: page.coverage, syncCursor: page.syncCursor },
    ];
    for (const old of expected.filter((entry) => overlaps(entry.coverage, page.coverage!))) {
      for (const remainder of uncovered(old.coverage, page.coverage)) {
        let next: typeof page.coverage | null = remainder;
        while (next && active() && epoch === db.epoch(scope)) {
          const part = await getHistoryRange(scope.chat, next, undefined, api);
          replacements.push(part);
          next = part.remaining;
        }
      }
    }
    if (active() && epoch === db.epoch(scope))
      db.replace(scope, expected, replacements, page.coverage);
  }
}

export async function refreshLocal(
  scope: Scope,
  place: ReadingPlace | null,
  active: () => boolean,
  api = requestClient(),
) {
  const db = localHistory();
  const pieces = db.read(scope, place);
  if (!pieces.length) await loadPage(scope, { mode: 'latest', limit: 20 }, active, api);
  else {
    // Check the anchor first; keep the number of simultaneous PostgREST requests bounded.
    const anchor = place && pieces.find((piece) => contains(piece.coverage, place));
    const queue = anchor ? [anchor, ...pieces.filter((p) => p !== anchor)] : pieces;
    let failure: unknown;
    for (let i = 0; i < queue.length && active(); i += 3) {
      const results = await Promise.allSettled(
        queue.slice(i, i + 3).map((piece) => reconcile(db, scope, piece, active, api)),
      );
      for (const result of results) if (result.status === 'rejected') failure = result.reason;
    }
    if (failure) throw failure;
    if (
      active() &&
      place?.messageId &&
      !db.read(scope, place).some((p) => p.items.some((item) => !item.message.hidden))
    ) {
      await loadPage(
        scope,
        {
          mode: 'around',
          messageId: place.messageId,
          itemId: place.itemId ?? undefined,
          savedSeq: place.seq,
          savedPosition: place.position,
          limit: 20,
        },
        active,
        api,
      );
    }
  }
}
