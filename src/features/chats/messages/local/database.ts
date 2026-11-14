import { Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { HistoryStorage, migrate } from './storage';

let storage: HistoryStorage | undefined;

export function localHistory() {
  if (!storage) {
    // The OS cache directory is private to this installation and excluded from device backups.
    const db = openDatabaseSync('open-history.db', {}, Paths.cache.uri);
    migrate(db);
    storage = new HistoryStorage(db);
  }
  return storage;
}
