// Очередь событий журнала: в памяти и на телефоне. Переживает убийство
// приложения и отсутствие сети: что не ушло, уйдёт после перезапуска.
//
// Место ограничено: сверх лимита вытесняется самое старое. Снимки одного
// показа (`impression_progress`) схлопываются — важен последний, а offline
// они копились бы каждые несколько секунд.

import type { JournalWireEvent } from '@/api/recJournal';

export type QueueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type JournalQueue = {
  /** Прочитать сохранённое; пришедшее до этого — остаётся следом. */
  load: () => Promise<void>;
  push: (event: JournalWireEvent) => void;
  /** До `max` ещё не отправляемых событий этого человека — они помечаются как в пути. */
  take: (userId: string, max: number) => JournalWireEvent[];
  /** Дошли (приняты или отклонены сервером) — убрать насовсем. */
  ack: (ids: string[]) => void;
  /** Не дошли — снова доступны для отправки. */
  release: (ids: string[]) => void;
  size: (userId?: string) => number;
  /** Записать на телефон сейчас, не дожидаясь таймера. */
  save: () => Promise<void>;
};

const SAVE_DELAY_MS = 1000;

function isEvent(value: unknown): value is JournalWireEvent {
  if (!value || typeof value !== 'object') return false;

  const event = value as Partial<JournalWireEvent>;

  return (
    typeof event.id === 'string' &&
    typeof event.kind === 'string' &&
    typeof event.ts === 'number' &&
    typeof event.user_id === 'string' &&
    typeof event.data === 'object' &&
    event.data !== null
  );
}

export function createJournalQueue({
  storage,
  key,
  maxEvents,
  maxAgeMs,
  now = Date.now,
}: {
  storage: QueueStorage;
  key: string;
  maxEvents: number;
  /** Старше — сервер всё равно отклонит. */
  maxAgeMs: number;
  now?: () => number;
}): JournalQueue {
  let events: JournalWireEvent[] = [];
  const inFlight = new Set<string>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const fresh = (event: JournalWireEvent) => now() - event.ts <= maxAgeMs;

  const trim = () => {
    events = events.filter(fresh);

    if (events.length > maxEvents) events = events.slice(events.length - maxEvents);
  };

  const save = async () => {
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = null;
    trim();

    try {
      await storage.setItem(key, JSON.stringify(events));
    } catch {
      // Диск недоступен — события остаются в памяти до следующей попытки.
    }
  };

  const scheduleSave = () => {
    if (!saveTimer) saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  return {
    async load() {
      let stored: JournalWireEvent[] = [];

      try {
        const raw = await storage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];

        stored = Array.isArray(parsed) ? parsed.filter(isEvent) : [];
      } catch {
        stored = [];
      }

      const known = new Set(events.map((event) => event.id));

      events = [...stored.filter((event) => !known.has(event.id)), ...events];
      trim();
    },

    push(event) {
      if (event.kind === 'impression_progress' && event.impression_id) {
        events = events.filter(
          (queued) =>
            inFlight.has(queued.id) ||
            queued.kind !== 'impression_progress' ||
            queued.impression_id !== event.impression_id,
        );
      }

      events.push(event);
      trim();
      scheduleSave();
    },

    take(userId, max) {
      const batch: JournalWireEvent[] = [];

      for (const event of events) {
        if (batch.length >= max) break;
        if (event.user_id !== userId || inFlight.has(event.id)) continue;

        inFlight.add(event.id);
        batch.push(event);
      }

      return batch;
    },

    ack(ids) {
      const done = new Set(ids);

      ids.forEach((id) => inFlight.delete(id));
      events = events.filter((event) => !done.has(event.id));
      scheduleSave();
    },

    release(ids) {
      ids.forEach((id) => inFlight.delete(id));
    },

    size(userId) {
      return userId ? events.filter((event) => event.user_id === userId).length : events.length;
    },

    save,
  };
}
