import { getHistoryChanges, getHistoryRange } from '@/api/historyWindow';
import type { HistoryCoverage } from '@/api/historyWindow';
import type { Piece, Scope, StoredPiece } from './segments';
import type { HistoryStorage } from './storage';

function hasDependencies(piece: Piece) {
  return piece.items.some(
    ({ message }) =>
      message.replies.length ||
      message.forwardGroup ||
      message.forward ||
      message.kind === 'comment_forward' ||
      message.attachments.length ||
      message.author ||
      message.member ||
      message.call,
  );
}

/** Never checkpoint an unfinished pass. Async work happens outside the SQLite transaction. */
export async function reconcile(
  storage: HistoryStorage,
  scope: Scope,
  piece: StoredPiece,
  active: () => boolean,
) {
  let cursor = piece.syncCursor;
  if (!hasDependencies(piece)) {
    while (active()) {
      const step = await getHistoryChanges(scope.chat, cursor);
      if (!active()) return;
      if (step.status === 'more') {
        cursor = step.cursor;
        continue;
      }
      if (step.status === 'current') {
        storage.confirm(scope, piece, step.cursor);
        return;
      }
      break;
    }
  }
  const parts: Piece[] = [];
  let range: HistoryCoverage | null = piece.coverage;
  while (range && active()) {
    const page = await getHistoryRange(scope.chat, range);
    parts.push(page);
    range = page.remaining;
  }
  if (active()) storage.replace(scope, [piece], parts, piece.coverage);
}
