import { requestClient } from '@/api/requestClient';
import type { DatabaseSync } from 'node:sqlite';
import { openHistoryDatabase } from '@/test/openHistoryDatabase';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getHistoryChanges,
  getHistoryRange,
  type HistoryCoverage,
  type HistoryItem,
} from '@/api/historyWindow';
import { reconcile } from './reconcile';
import { overlaps, uncovered, type Piece } from './segments';
import type { HistoryStorage } from './storage';

jest.mock('@/api/historyWindow', () => ({
  getHistoryChanges: jest.fn(),
  getHistoryRange: jest.fn(),
}));
const scope = { reader: 'a', chat: 'chat' };
const other = { ...scope, reader: 'b' };
const bound = (seq: number, inclusive = true) => ({ seq, position: 0, inclusive });
const coverage = (a: number, b: number): HistoryCoverage => ({ lower: bound(a), upper: bound(b) });
function piece(a: number, b: number, key: string): Piece {
  const item = {
    key,
    messageId: key,
    position: { seq: a, position: 0 },
    message: { id: key, replies: [], attachments: [], text: key },
  } as unknown as HistoryItem;
  return { coverage: coverage(a, b), items: [item], syncCursor: `h1.${key}` };
}
let directory: string;
let native: DatabaseSync;
let storage: HistoryStorage;
function open() {
  ({ native, storage } = openHistoryDatabase(join(directory, 'history.db')));
}
beforeEach(() => {
  jest.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'open-history-'));
  open();
});
afterEach(() => {
  native.close();
  rmSync(directory, { recursive: true, force: true });
});
function insert(p: Piece) {
  expect(storage.replace(scope, storage.entries(scope), [p], p.coverage)).toBe(true);
}
it('replays a lost acknowledgement after a process restart without erasing a later occurrence', () => {
  const early = { seq: 8, position: 1, key: 'first' },
    late = { seq: 8, position: 3, key: 'third' };
  storage.reach(scope, early);
  const sent = storage.pending(scope.reader)[0];
  native.close();
  open();
  expect(storage.pending(scope.reader)).toEqual([sent]);
  storage.reach(scope, late);
  storage.acknowledge(scope, sent);
  expect(storage.pending(scope.reader)).toEqual([{ ...late, chat: scope.chat }]);
  expect(storage.pending(other.reader)).toEqual([]);
  storage.acknowledge(scope, late);
  storage.acknowledge(scope, early);
  expect(storage.reach(scope, early)).toBe(false);
  expect(storage.pending(scope.reader)).toEqual([]);
});
const changes = jest.mocked(getHistoryChanges),
  range = jest.mocked(getHistoryRange);
it('reopens at the occurrence, preserves a hole and isolates readers', () => {
  insert(piece(1, 5, 'old'));
  insert(piece(8, 16, 'middle'));
  const place = { key: 'old', seq: 1, position: 0, offset: -900 };
  storage.savePlace(scope, place);
  native.close();
  open();
  expect(storage.place(scope)).toEqual(place);
  expect(storage.entries(scope)).toHaveLength(2);
  expect(storage.read(scope).map((p) => p.syncCursor)).toEqual(['h1.old']);
  expect(storage.read(other)).toEqual([]);
  expect(storage.place(other)).toBeNull();
});
it('keeps the starting ticket after empty more and failure, then replaces an expired growing range atomically', async () => {
  insert(piece(1, 16, 'old'));
  insert(piece(30, 40, 'separate'));
  const before = storage.read(scope, null)[0];
  const place = { key: 'old', seq: 1, position: 0, offset: 14 };
  storage.savePlace(scope, place);
  const old = storage.read(scope)[0];
  changes
    .mockResolvedValueOnce({ status: 'more', parentIds: [], cursor: 'h1.next' })
    .mockRejectedValueOnce(Error('offline'));
  await expect(reconcile(storage, scope, old, () => true)).rejects.toThrow('offline');
  expect(changes).toHaveBeenLastCalledWith('chat', 'h1.next', undefined, requestClient());
  expect(storage.read(scope)[0]).toEqual(old);
  const first = piece(1, 8, 'replaced'),
    second = piece(9, 16, 'next');
  second.coverage.lower = bound(8, false);
  const mockRange = () =>
    range
      .mockResolvedValueOnce({ ...first, remaining: second.coverage })
      .mockResolvedValueOnce({ ...second, remaining: null });
  changes.mockResolvedValue({ status: 'expired', cursor: null, parentIds: [] });
  mockRange();
  native.exec(
    "CREATE TRIGGER fail BEFORE INSERT ON history_piece WHEN new.cursor='h1.next' BEGIN SELECT raise(ABORT,'disk full'); END;",
  );
  await expect(reconcile(storage, scope, old, () => true)).rejects.toThrow('disk full');
  native.close();
  open();
  expect(storage.read(scope)[0]).toEqual(old);
  native.exec('DROP TRIGGER fail');
  mockRange();
  await reconcile(storage, scope, old, () => true);
  expect(range).toHaveBeenLastCalledWith('chat', second.coverage, undefined, requestClient());
  expect(storage.read(scope).map((p) => p.syncCursor)).toEqual(['h1.replaced', 'h1.next']);
  expect(storage.read(scope, null)[0]).toEqual(before);
  expect(storage.confirm(scope, old, 'h1.late')).toBe(false);
});
it('rereads a quote even if only its embedded preview changed, rejects late and foreign writes', async () => {
  const p = piece(1, 8, 'reply');
  const quote = {
    state: 'live' as const,
    messageId: 'quote',
    authorId: null,
    authorName: null,
    seq: 1,
    createdAt: null,
    editMark: null,
    preview: {
      kind: 'text' as const,
      text: 'before',
      thumbnailUrl: null,
      mediaCount: 0,
      firstMediaIsVideo: false,
      durationMs: null,
    },
  };
  p.items[0].message.replies = [quote];
  insert(p);
  const old = storage.read(scope)[0];
  const fresh = JSON.parse(JSON.stringify(p)) as Piece;
  fresh.items[0].message.replies = [{ ...quote, preview: { ...quote.preview, text: 'after' } }];
  fresh.syncCursor = 'h1.fresh';
  range.mockResolvedValue({ ...fresh, remaining: null });
  await reconcile(storage, scope, old, () => true);
  expect(changes).not.toHaveBeenCalled();
  expect(storage.read(scope)[0].items).toEqual(fresh.items);
  expect(storage.replace(scope, [old], [p], p.coverage)).toBe(false);
  expect(storage.confirm(other, old, 'h1.foreign')).toBe(false);
});
it('advances only the verified ticket and rejects a late current verdict', async () => {
  insert(piece(1, 8, 'current'));
  insert(piece(10, 12, 'other'));
  const place = { key: 'current', seq: 1, position: 0, offset: 0 };
  storage.savePlace(scope, place);
  const current = storage.read(scope)[0];
  changes.mockResolvedValue({ status: 'current', cursor: 'h1.checked', parentIds: [] });
  await reconcile(storage, scope, current, () => true);
  expect(storage.read(scope)[0].syncCursor).toBe('h1.checked');
  expect(storage.confirm(scope, current, 'h1.late')).toBe(false);
  expect(storage.read(scope, null)[0].syncCursor).toBe('h1.other');
});

it('keeps both ends of adjacent partial groups when navigating across an exclusive boundary', () => {
  const p = piece(1, 1, 'middle'),
    next = piece(1, 1, 'newer');
  const b = (position: number, inclusive: boolean) => ({ seq: 1, position, inclusive });
  p.coverage = { lower: b(50, true), upper: b(80, false) };
  next.coverage = { lower: b(79, false), upper: null };
  insert(p);
  insert(next);
  expect(overlaps(p.coverage, next.coverage)).toBe(false);
  expect(storage.read(scope)).toHaveLength(2);
  expect(uncovered(p.coverage, { lower: b(55, true), upper: b(70, true) })).toEqual([
    { lower: b(50, true), upper: b(55, false) },
    { lower: b(70, false), upper: b(80, false) },
  ]);
});
