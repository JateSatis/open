import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { SearchEntity, SearchMessage } from '@/api/search';

/**
 * «Недавние» поиска: что человек открывал из выдачи. Лежат на телефоне — у
 * каждого аккаунта свои, под своим ключом: сеанс мог закончиться, пока
 * приложение было закрыто, и тогда сброс при выходе не случился бы. При
 * выходе из аккаунта стираются вместе с прочим клиентским состоянием
 * (`resetClientState`).
 *
 * Это снимок строки выдачи на момент тапа: переименованный канал или
 * удалённое сообщение здесь не обновятся — тап откроет актуальное.
 */
export type RecentSearch =
  { type: 'entity'; entity: SearchEntity } | { type: 'message'; message: SearchMessage };

export const RECENT_SEARCHES_LIMIT = 20;

const STORAGE_PREFIX = 'search.recent.v1:';

type RecentState = {
  /** Чьи это недавние; null — ещё не читали или вышли из аккаунта. */
  owner: string | null;
  items: RecentSearch[];
};

export const useRecentSearches = create<RecentState>(() => ({ owner: null, items: [] }));

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

function merge(first: RecentSearch[], second: RecentSearch[]): RecentSearch[] {
  const seen = new Set<string>();

  return [...first, ...second]
    .filter((item) => {
      const key = recentKey(item);

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RECENT_SEARCHES_LIMIT);
}

function save(owner: string, items: RecentSearch[]) {
  useRecentSearches.setState({ owner, items });
  void AsyncStorage.setItem(STORAGE_PREFIX + owner, JSON.stringify(items)).catch(() => undefined);
}

// Чтение, начатое до выхода из аккаунта или до «Очистить», свой результат
// уже не кладёт: иначе вернулись бы недавние прежнего человека или стёртые.
let generation = 0;

/** Прочитать с телефона недавние этого человека — если в памяти сейчас не его. */
export function loadRecentSearches(owner: string): void {
  if (useRecentSearches.getState().owner === owner) return;

  generation += 1;
  const started = generation;
  useRecentSearches.setState({ owner, items: [] });

  void AsyncStorage.getItem(STORAGE_PREFIX + owner)
    .catch(() => null)
    .then((raw) => {
      if (started !== generation || useRecentSearches.getState().owner !== owner) return;

      // Пока читали, могли уже открыть что-то из поиска — оно новее сохранённого.
      const stored = parseRecentSearches(raw);
      const current = useRecentSearches.getState().items;

      if (current.length === 0) useRecentSearches.setState({ items: stored });
      else save(owner, merge(current, stored));
    });
}

/** Открытое из поиска — наверх; уже было — переезжает наверх, а не дублируется. */
export function addRecentSearch(item: RecentSearch): void {
  const { owner, items } = useRecentSearches.getState();

  if (!owner) return;

  save(owner, merge([item], items));
}

export function clearRecentSearches(): void {
  const { owner } = useRecentSearches.getState();

  if (!owner) return;

  generation += 1;
  save(owner, []);
}

/** Выход из аккаунта: в памяти и на телефоне — пусто. */
export function resetRecentSearches(): void {
  const { owner } = useRecentSearches.getState();

  generation += 1;
  useRecentSearches.setState({ owner: null, items: [] });
  if (owner) void AsyncStorage.removeItem(STORAGE_PREFIX + owner).catch(() => undefined);
}
