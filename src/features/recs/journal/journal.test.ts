import { createJournal } from './journal';
import type { QueueStorage } from './queue';

import type { JournalSendResult, JournalWireEvent } from '@/api/recJournal';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn() } }));

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const storage: QueueStorage = {
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
  };

  return { storage, data };
}

/** Сервер: принимает всё, кроме указанных причин; дубли — как принятые. */
function fakeServer() {
  const stored = new Map<string, JournalWireEvent>();
  const calls: JournalWireEvent[][] = [];
  let offline = false;
  const send = jest.fn(async (events: JournalWireEvent[]): Promise<JournalSendResult> => {
    calls.push(events);

    if (offline) throw new TypeError('Network request failed');

    const rejected = events
      .filter((event) => event.kind === 'impression_end' && event.data.watch_ms === -1)
      .map((event) => ({ id: event.id, reason: 'implausible' }));
    const bad = new Set(rejected.map((item) => item.id));
    const accepted = events.filter((event) => !bad.has(event.id)).map((event) => event.id);

    events.forEach((event) => {
      if (!bad.has(event.id)) stored.set(event.id, event);
    });

    return { accepted, rejected };
  });

  return {
    send,
    stored,
    calls,
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('журнал рекомендаций', () => {
  it('копит события и отправляет пачкой через несколько секунд', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    journal.setAppSession('s1');
    journal.log('search_query', { surface: 'search', data: { query: 'кот' } });
    journal.log('screen_time', { data: { screen: 'feed', ms: 1000 } });

    expect(server.send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);

    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].map((event) => event.kind)).toEqual(['search_query', 'screen_time']);
    expect(server.calls[0][0]).toMatchObject({
      user_id: 'u1',
      app_session_id: 's1',
      surface: 'search',
      v: 1,
    });
    expect(journal.queue.size()).toBe(0);
  });

  it('без человека ничего не пишет', () => {
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: fakeServer().send,
      watchAppState: false,
    });

    expect(journal.log('search_query', { data: { query: 'x' } })).toBeNull();
    expect(journal.queue.size()).toBe(0);
  });

  it('без сети копит, повторяет с паузой и отправляет всё без дублей, когда сеть вернулась', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    server.setOffline(true);

    for (let i = 0; i < 3; i += 1) {
      journal.log('impression_start', {
        impressionId: `i${i}`,
        subject: { type: 'pop', id: `p${i}` },
        surface: 'channel',
      });
      journal.log('impression_end', {
        impressionId: `i${i}`,
        data: { watch_ms: 1000, visible_ms: 1200, exit: 'swipe_next' },
      });
    }

    await jest.advanceTimersByTimeAsync(5000);
    expect(server.calls).toHaveLength(1);
    expect(journal.queue.size()).toBe(6);

    // Пауза растёт: следующая попытка — через 10 с, не через 5.
    await jest.advanceTimersByTimeAsync(5000);
    expect(server.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(server.calls).toHaveLength(2);

    server.setOffline(false);
    await jest.advanceTimersByTimeAsync(20_000);

    expect(server.stored.size).toBe(6);
    expect(journal.queue.size()).toBe(0);
    const sentIds = server.calls.slice(-1)[0].map((event) => event.id);
    expect(new Set(sentIds).size).toBe(sentIds.length);
  });

  it('отклонённое сервером снимается из очереди и не шлётся вечно', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    journal.log('impression_end', {
      impressionId: 'i1',
      data: { watch_ms: -1, visible_ms: 0, exit: 'close' },
    });
    await jest.advanceTimersByTimeAsync(5000);

    expect(journal.queue.size()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(server.calls).toHaveLength(1);
  });

  it('событие, которое база не может принять, не держит очередь: пачка делится, оно выбрасывается', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const delivered: string[] = [];
    const send = jest.fn(async (events: JournalWireEvent[]): Promise<JournalSendResult> => {
      if (events.some((event) => event.data.query === 'poison')) {
        throw Object.assign(new Error('invalid input syntax for type json'), { code: '22P02' });
      }

      delivered.push(...events.map((event) => String(event.data.query)));

      return { accepted: events.map((event) => event.id), rejected: [] };
    });
    const journal = createJournal({ storage: memoryStorage().storage, send, watchAppState: false });

    journal.setUser('u1');
    ['a', 'b', 'poison', 'c', 'd'].forEach((query) =>
      journal.log('search_query', { data: { query } }),
    );
    await jest.advanceTimersByTimeAsync(5000);

    expect(delivered.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(journal.queue.size()).toBe(0);
  });

  it('сеть вернулась — накопленное уходит сразу, не дожидаясь паузы повтора', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    server.setOffline(true);
    journal.log('search_query', { data: { query: 'x' } });
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(server.calls).toHaveLength(3);

    server.setOffline(false);
    journal.kick();
    await jest.advanceTimersByTimeAsync(0);

    expect(server.stored.size).toBe(1);
  });

  it('переживает перезапуск: что не ушло, уходит после него', async () => {
    const { storage, data } = memoryStorage();
    const offline = fakeServer();
    const first = createJournal({ storage, send: offline.send, watchAppState: false });

    offline.setOffline(true);
    first.setUser('u1');
    first.log('impression_start', {
      impressionId: 'i1',
      subject: { type: 'pop', id: 'p1' },
      surface: 'channel',
    });
    first.log('impression_progress', {
      impressionId: 'i1',
      data: { watch_ms: 5000, visible_ms: 5000 },
    });
    await first.persist();

    expect(JSON.parse(data['rec-journal-queue-v1'])).toHaveLength(2);

    // Приложение убито; новый процесс.
    const server = fakeServer();
    const second = createJournal({ storage, send: server.send, watchAppState: false });

    second.setUser('u1');
    await settle();
    await jest.advanceTimersByTimeAsync(0);

    expect(server.stored.size).toBe(2);
    expect([...server.stored.values()].map((event) => event.kind)).toEqual([
      'impression_start',
      'impression_progress',
    ]);
  });

  it('снимки одного показа схлопываются в очереди — уходит последний', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    server.setOffline(true);
    journal.log('impression_start', {
      impressionId: 'i1',
      subject: { type: 'pop', id: 'p1' },
      surface: 'channel',
    });

    for (let watch = 1000; watch <= 5000; watch += 1000) {
      journal.log('impression_progress', {
        impressionId: 'i1',
        data: { watch_ms: watch, visible_ms: watch },
      });
    }

    expect(journal.queue.size()).toBe(2);
    server.setOffline(false);
    await jest.advanceTimersByTimeAsync(5000);

    const progress = [...server.stored.values()].filter(
      (event) => event.kind === 'impression_progress',
    );

    expect(progress).toHaveLength(1);
    expect(progress[0].data.watch_ms).toBe(5000);
  });

  it('события другого аккаунта не уходят от имени вошедшего', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
      watchAppState: false,
    });

    journal.setUser('u1');
    server.setOffline(true);
    journal.log('search_query', { data: { query: 'a' } });
    journal.setUser('u2');
    server.setOffline(false);
    journal.log('search_query', { data: { query: 'b' } });
    await jest.advanceTimersByTimeAsync(5000);

    expect([...server.stored.values()].map((event) => event.user_id)).toEqual(['u2']);
    expect(journal.queue.size('u1')).toBe(1);
  });
});
