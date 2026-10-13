import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { SearchEntity, SearchMessage } from '@/api/search';

/**
 * «Недавние» поиска: что человек открывал из выдачи. Лежат на телефоне,
 * общие для всех экранов; при выходе из аккаунта стираются вместе с прочим
 * клиентским состоянием (`resetClientState`).
 */
export type RecentSearch =
  { type: 'entity'; entity: SearchEntity } | { type: 'message'; message: SearchMessage };

export const RECENT_SEARCHES_LIMIT = 20;

const STORAGE_KEY = 'search.recent.v1';

type RecentState = { items: RecentSearch[]; loaded: boolean };

export const useRecentSearches = create<RecentState>(() => ({ items: [], loaded: false }));

export function recentKey(item: RecentSearch): string {
  return item.type === 'entity'
    ? `${item.entity.kind}:${item.entity.id}`
    : `message:${item.message.id}`;
}

function isRecent(value: unknown): value is RecentSearch {
  if (typeof value !== 'object' || value === null) return false;

  const item = value as { type?: unknown; entity?: { id?: unknown }; message?: { id?: unknown } };

  if (item.type === 'entity') return typeof item.entity?.id === 'string';
  if (item.type === 'message') return typeof item.message?.id === 'string';

  return false;
}

/** Сохранённое — с проверкой: файл мог остаться от старой версии или побиться. */
export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENT_SEARCHES_LIMIT) : [];
  } catch {
    return [];
  }
}

// Выход из аккаунта во время чтения не должен вернуть недавние прежнего
// человека: чтение, начатое до сброса, свой результат уже не кладёт.
let generation = 0;

/** Прочитать с телефона — один раз за жизнь приложения, до первого показа. */
export function loadRecentSearches(): void {
  if (useRecentSearches.getState().loaded) return;

  const started = generation;

  void AsyncStorage.getItem(STORAGE_KEY)
    .catch(() => null)
    .then((raw) => {
      if (started !== generation || useRecentSearches.getState().loaded) return;

      useRecentSearches.setState({ items: parseRecentSearches(raw), loaded: true });
    });
}

function save(items: RecentSearch[]) {
  useRecentSearches.setState({ items, loaded: true });
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)).catch(() => undefined);
}

/** Открытое из поиска — наверх; уже было — переезжает наверх, а не дублируется. */
export function addRecentSearch(item: RecentSearch): void {
  const key = recentKey(item);
  const rest = useRecentSearches.getState().items.filter((existing) => recentKey(existing) !== key);

  save([item, ...rest].slice(0, RECENT_SEARCHES_LIMIT));
}

export function clearRecentSearches(): void {
  save([]);
}

/** Выход из аккаунта: в памяти и на телефоне — пусто. */
export function resetRecentSearches(): void {
  generation += 1;
  useRecentSearches.setState({ items: [], loaded: true });
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
}
