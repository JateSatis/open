import type { SQLiteDatabase } from 'expo-sqlite';
import type { HistoryCoverage } from '@/api/historyWindow';
import {
  connected,
  contains,
  overlaps,
  type Scope,
  type Piece,
  type StoredPiece,
  type ReadingPlace,
} from './segments';

export type HistoryDatabase = Pick<
  SQLiteDatabase,
  'execSync' | 'runSync' | 'getAllSync' | 'getFirstSync' | 'withTransactionSync'
>;
type Entry = { id: number; coverage: HistoryCoverage; syncCursor: Piece['syncCursor'] };
const MAX_PIECES = 256;
const MAX_BYTES = 32 * 1024 * 1024;

export function migrate(db: HistoryDatabase) {
  db.execSync('PRAGMA journal_mode=WAL');
  db.withTransactionSync(() => {
    const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version;
    if (version > 1) throw new Error('Unsupported history schema');
    if (version === 0)
      db.execSync(`
      CREATE TABLE history_piece (
        id INTEGER PRIMARY KEY AUTOINCREMENT, reader TEXT NOT NULL, chat TEXT NOT NULL,
        bounds TEXT NOT NULL, cursor TEXT NOT NULL, items TEXT NOT NULL, bytes INTEGER NOT NULL,
        protected INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL
      );
      CREATE INDEX history_owner ON history_piece(reader, chat);
      CREATE TABLE reading_place(reader TEXT, chat TEXT, value TEXT NOT NULL, PRIMARY KEY(reader,chat));
      CREATE TABLE history_route(reader TEXT, route TEXT, value TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(reader,route));
      PRAGMA user_version=1;
    `);
  });
}

export class HistoryStorage {
  constructor(readonly db: HistoryDatabase) {}
  // In-flight requests only exist within this process. A purge invalidates even requests
  // for previously empty coverage; IDs alone cannot distinguish empty from emptied.
  private epochs = new Map<string, number>();
  epoch({ reader, chat }: Scope) {
    return this.epochs.get(reader + '/' + chat) ?? 0;
  }

  place({ reader, chat }: Scope): ReadingPlace | null {
    const row = this.db.getFirstSync<{ value: string }>(
      'SELECT value FROM reading_place WHERE reader=? AND chat=?',
      reader,
      chat,
    );
    return row ? JSON.parse(row.value) : null;
  }

  savePlace(scope: Scope, place: ReadingPlace) {
    const owner = this.entries(scope).find((p) => contains(p.coverage, place));
    if (!owner) return;
    const previous = this.place(scope);
    if (
      previous?.key === place.key &&
      previous.offset === place.offset &&
      previous.seq === place.seq &&
      previous.position === place.position
    )
      return;
    this.db.withTransactionSync(() => {
      this.db.runSync(
        'INSERT OR REPLACE INTO reading_place VALUES (?,?,?)',
        scope.reader,
        scope.chat,
        JSON.stringify(place),
      );
      this.db.runSync(
        'UPDATE history_piece SET protected=(id=?) WHERE reader=? AND chat=?',
        owner.id,
        scope.reader,
        scope.chat,
      );
      this.db.runSync('UPDATE history_piece SET used=? WHERE id=?', Date.now(), owner.id);
    });
  }

  entries({ reader, chat }: Scope): Entry[] {
    return this.db
      .getAllSync<{ id: number; bounds: string; cursor: Piece['syncCursor'] }>(
        'SELECT id,bounds,cursor FROM history_piece WHERE reader=? AND chat=? ORDER BY id',
        reader,
        chat,
      )
      .map((row) => ({ id: row.id, coverage: JSON.parse(row.bounds), syncCursor: row.cursor }));
  }

  read(scope: Scope, place = this.place(scope)): StoredPiece[] {
    return connected(this.entries(scope), place).map(({ id, coverage }) => {
      const row = this.db.getFirstSync<{ items: string; cursor: Piece['syncCursor'] }>(
        'SELECT items,cursor FROM history_piece WHERE id=?',
        id,
      )!;
      return { id, coverage, items: JSON.parse(row.items), syncCursor: row.cursor };
    });
  }

  /** IDs are never reused. Only intersecting generations participate in the compare-and-swap. */
  replace(scope: Scope, expected: Entry[], pieces: Piece[], range: HistoryCoverage) {
    let applied = false;
    this.db.withTransactionSync(() => {
      const current = this.entries(scope).filter((p) => overlaps(p.coverage, range));
      const original = expected.filter((p) => overlaps(p.coverage, range));
      if (
        current.length !== original.length ||
        current.some((p, i) => p.id !== original[i].id || p.syncCursor !== original[i].syncCursor)
      )
        return;
      const place = this.place(scope);
      for (const row of current) this.db.runSync('DELETE FROM history_piece WHERE id=?', row.id);
      for (const piece of pieces) {
        const json = JSON.stringify(piece.items);
        this.db.runSync(
          `INSERT INTO history_piece(reader,chat,bounds,cursor,items,bytes,protected,used)
          VALUES (?,?,?,?,?,length(CAST(? AS BLOB)),?,?)`,
          scope.reader,
          scope.chat,
          JSON.stringify(piece.coverage),
          piece.syncCursor,
          json,
          json,
          Number(Boolean(place && contains(piece.coverage, place))),
          Date.now(),
        );
      }
      this.db.runSync(
        `DELETE FROM history_piece WHERE id IN (
        SELECT id FROM (SELECT id, row_number() OVER w AS n, sum(bytes) OVER w AS total FROM history_piece
        WINDOW w AS (ORDER BY protected DESC, used DESC, id DESC ROWS UNBOUNDED PRECEDING))
        WHERE n>? OR (n>1 AND total>?)
      )`,
        MAX_PIECES,
        MAX_BYTES,
      );
      this.db.runSync(
        'DELETE FROM reading_place WHERE NOT EXISTS (SELECT 1 FROM history_piece WHERE history_piece.reader=reading_place.reader AND history_piece.chat=reading_place.chat)',
      );
      applied = true;
    });
    return applied;
  }

  confirm(scope: Scope, piece: StoredPiece, cursor: Piece['syncCursor']) {
    // The current verdict confirms identical content. Never move a newer ticket backwards.
    const result = this.db.runSync(
      'UPDATE history_piece SET cursor=? WHERE reader=? AND chat=? AND id=? AND cursor=?',
      cursor,
      scope.reader,
      scope.chat,
      piece.id,
      piece.syncCursor,
    );
    return result.changes === 1;
  }

  forget({ reader, chat }: Scope) {
    this.epochs.set(reader + '/' + chat, this.epoch({ reader, chat }) + 1);
    this.db.withTransactionSync(() => {
      this.db.runSync('DELETE FROM history_piece WHERE reader=? AND chat=?', reader, chat);
      this.db.runSync('DELETE FROM reading_place WHERE reader=? AND chat=?', reader, chat);
    });
  }

  route<T>(reader: string, key: string): T | undefined {
    const row = this.db.getFirstSync<{ value: string }>(
      'SELECT value FROM history_route WHERE reader=? AND route=?',
      reader,
      key,
    );
    return row ? JSON.parse(row.value) : undefined;
  }

  setRoute(reader: string, key: string, value: unknown) {
    this.db.withTransactionSync(() => {
      this.db.runSync(
        'INSERT OR REPLACE INTO history_route VALUES (?,?,?,?)',
        reader,
        key,
        JSON.stringify(value),
        Date.now(),
      );
      this.db.runSync(
        'DELETE FROM history_route WHERE rowid IN (SELECT rowid FROM history_route ORDER BY used DESC,rowid DESC LIMIT -1 OFFSET 256)',
      );
    });
  }
}
