import { DatabaseSync } from 'node:sqlite';
import {
  migrate,
  HistoryStorage,
  type HistoryDatabase,
} from '@/features/chats/messages/local/storage';

export function openHistoryDatabase(path: string) {
  const native = new DatabaseSync(path);
  const db: HistoryDatabase = {
    execSync: (sql) => native.exec(sql),
    runSync: (sql: string, ...values: (string | number)[]) => {
      const r = native.prepare(sql).run(...values);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllSync: <T>(sql: string, ...values: (string | number)[]) =>
      native.prepare(sql).all(...values) as T[],
    getFirstSync: <T>(sql: string, ...values: (string | number)[]) =>
      (native.prepare(sql).get(...values) as T) ?? null,
    withTransactionSync: (fn) => {
      native.exec('BEGIN IMMEDIATE');
      try {
        fn();
        native.exec('COMMIT');
      } catch (e) {
        native.exec('ROLLBACK');
        throw e;
      }
    },
  } as HistoryDatabase;
  migrate(db);
  return { native, storage: new HistoryStorage(db) };
}
