import AsyncStorage from '@react-native-async-storage/async-storage';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { SearchEntity, SearchMessage } from '@/api/search';

/**
 * «Недавние» поиска. Лежат на телефоне — у каждого аккаунта свои, под своим
 * ключом: сеанс мог закончиться, пока приложение было закрыто, и тогда сброс
 * при выходе не случился бы. При выходе из аккаунта стираются вместе с
 * прочим клиентским состоянием (`resetClientState`).
 *
 * Списков два, механика одна (`createRecentList`):
 *   «Чаты»  — что человек открывал из выдачи: снимок строки на момент тапа
 *             (переименованный канал или удалённое сообщение здесь не
 *             обновятся — тап откроет актуальное);
 *   «Лента» — сами запросы текстом, как в TikTok.
 */
export type RecentSearch =
  { type: 'entity'; entity: SearchEntity } | { type: 'message'; message: SearchMessage };

export const RECENT_SEARCHES_LIMIT = 20;

type RecentState<T> = {
  /** Чьи это недавние; null — ещё не читали или вышли из аккаунта. */
  owner: string | null;
  items: T[];
};

export type RecentList<T> = {
  useStore: UseBoundStore<StoreApi<RecentState<T>>>;
  /** Сохранённое — с проверкой: файл мог остаться от старой версии или побиться. */
  parse: (raw: string | null) => T[];
  /** Прочитать с телефона недавние этого человека — если в памяти сейчас не его. */
  load: (owner: string) => void;
  /** Новое — наверх; уже было — переезжает наверх, а не дублируется. */
  add: (item: T) => void;
  clear: () => void;
  /** Выход из аккаунта: в памяти и на телефоне — пусто. */
  reset: () => void;
};

export function createRecentList<T>({
  prefix,
  keyOf,
  isItem,
}: {
  /** Ключ хранилища без владельца. */
  prefix: string;
  keyOf: (item: T) => string;
  isItem: (value: unknown) => value is T;
}): RecentList<T> {
  const useStore = create<RecentState<T>>(() => ({ owner: null, items: [] }));

  const parse = (raw: string | null): T[] => {
    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed.filter(isItem).slice(0, RECENT_SEARCHES_LIMIT) : [];
    } catch {
      return [];
    }
  };

  const merge = (first: T[], second: T[]): T[] => {
    const seen = new Set<string>();

    return [...first, ...second]
      .filter((item) => {
        const key = keyOf(item);

        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, RECENT_SEARCHES_LIMIT);
  };

  const save = (owner: string, items: T[]) => {
    useStore.setState({ owner, items });
    void AsyncStorage.setItem(prefix + owner, JSON.stringify(items)).catch(() => undefined);
  };

  // Чтение, начатое до выхода из аккаунта или до «Очистить», свой результат
  // уже не кладёт: иначе вернулись бы недавние прежнего человека или стёртые.
  let generation = 0;

  return {
    useStore,
    parse,
    load: (owner) => {
      if (useStore.getState().owner === owner) return;

      generation += 1;
      const started = generation;
      useStore.setState({ owner, items: [] });

      void AsyncStorage.getItem(prefix + owner)
        .catch(() => null)
        .then((raw) => {
          if (started !== generation || useStore.getState().owner !== owner) return;

          // Пока читали, могли уже что-то добавить — оно новее сохранённого.
          const stored = parse(raw);
          const current = useStore.getState().items;

          if (current.length === 0) useStore.setState({ items: stored });
          else save(owner, merge(current, stored));
        });
    },
    add: (item) => {
      const { owner, items } = useStore.getState();

      if (!owner) return;

      save(owner, merge([item], items));
    },
    clear: () => {
      const { owner } = useStore.getState();

      if (!owner) return;

      generation += 1;
      save(owner, []);
    },
    reset: () => {
      const { owner } = useStore.getState();

      generation += 1;
      useStore.setState({ owner: null, items: [] });
      if (owner) void AsyncStorage.removeItem(prefix + owner).catch(() => undefined);
    },
  };
}

// =============================================================================
// «Чаты»
// =============================================================================

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

const chats = createRecentList<RecentSearch>({
  // Сохраняем формат v2 для уже записанной истории поиска.
  prefix: 'search.recent.v2:',
  keyOf: recentKey,
  isItem: isRecent,
});

export const useRecentSearches = chats.useStore;
export const parseRecentSearches = chats.parse;
export const loadRecentSearches = chats.load;
export const addRecentSearch = chats.add;
export const clearRecentSearches = chats.clear;

// =============================================================================
// «Лента»
// =============================================================================

/** Недавние запросы «Ленты» — текстом; один и тот же запрос — одной строкой. */
export const feedRecentQueries = createRecentList<string>({
  prefix: 'search.feed-recent.v1:',
  keyOf: (query) => query.trim().toLowerCase(),
  isItem: (value): value is string => typeof value === 'string' && value.trim() !== '',
});

/** Выход из аккаунта: оба списка — пусто. */
export function resetRecentSearches(): void {
  chats.reset();
  feedRecentQueries.reset();
}
