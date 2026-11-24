import { createJournal } from './journal';
import type { QueueStorage } from './queue';

import type { JournalSendResult, JournalWireEvent } from '@/api/recJournal';
import { recordJournalEvents } from '@/api/recJournal';
import { supabase } from '@/api/supabase';
import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import {
  reportRequestSucceeded,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { sessionOf } from '@/test/sessionOf';

const mockSetHeader = jest.fn();
jest.mock('@/api/supabase', () => ({
  supabase: {
    sessionOwner: () => ({ userId: 'a', sessionId: 's1' }),
    rpc: jest.fn(() => ({ setHeader: mockSetHeader })),
    auth: { getSession: jest.fn() },
  },
}));

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
  it('закрепляет токен владельца за RPC и сохраняет пачку, если SDK вернул чужой токен', async () => {
    const a = sessionOf('a', 's1');
    const b = sessionOf('b', 's2');
    useSessionStore.setState({ localAccountId: 'a', sdkStatus: 'session', session: a });
    reportRequestSucceeded();
    try {
      const journal = createJournal({
        storage: memoryStorage().storage,
        send: recordJournalEvents,
      });
      const rpc = jest.mocked(supabase.rpc);
      journal.setUser('a', 's1');
      journal.setDeliveryUser('a');
      const id = journal.log('app_session_start');
      mockSetHeader.mockResolvedValue({ data: { accepted: [id], rejected: [] }, error: null });
      jest
        .mocked(supabase.auth.getSession)
        .mockResolvedValue({ data: { session: b }, error: null });
      journal.showFirstScreen();
      await jest.advanceTimersByTimeAsync(0);
      expect(rpc).not.toHaveBeenCalled();
      expect(journal.queue.size('a')).toBe(1);
      jest
        .mocked(supabase.auth.getSession)
        .mockResolvedValue({ data: { session: a }, error: null });
      await journal.flush();
      expect(mockSetHeader).toHaveBeenCalledWith('Authorization', 'Bearer ' + a.access_token);
      expect(journal.queue.size('a')).toBe(0);
    } finally {
      useSessionStore.setState(emptyState);
      resetConnectionState();
    }
  });

  it('восстанавливает и сохраняет очередь под splash; отправляет только подтверждённому владельцу', async () => {
    const key = 'rec-journal-queue-v1';
    const old = { id: 'old', sessionId: 's1', kind: 'search_query', user_id: 'a', ts: Date.now(), v: 1, data: {} };
    const { storage, data } = memoryStorage({ [key]: JSON.stringify([old]) });
    let finishRead!: () => void;
    storage.getItem = () =>
      new Promise((resolve) => {
        finishRead = () => resolve(data[key]);
      });
    const server = fakeServer();
    const journal = createJournal({ storage, send: server.send });
    journal.setUser('a', 's1');
    journal.log('app_session_start');
    const saved = journal.persist();
    journal.setDeliveryUser('a');
    journal.kick();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(JSON.parse(data[key])).toEqual([old]);
    finishRead();
    await saved;
    expect(JSON.parse(data[key])).toHaveLength(2);
    await journal.flush();
    expect(server.send).not.toHaveBeenCalled();

    journal.setDeliveryUser(null);
    journal.showFirstScreen();
    journal.setDeliveryUser('b');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(server.send).not.toHaveBeenCalled();
    journal.setDeliveryUser('a');
    await jest.advanceTimersByTimeAsync(0);
    expect(server.calls.map((batch) => batch.map((e) => [e.user_id, e.kind]))).toEqual([
      [
        ['a', 'search_query'],
        ['a', 'app_session_start'],
      ],
    ]);
  });

  it('после обновления доставляет только событие с известной исходной сессией', async () => {
    const old = { id: 'legacy', kind: 'search_query', user_id: 'a', ts: Date.now(), v: 1, data: {} };
    const { storage } = memoryStorage({ 'rec-journal-queue-v1': JSON.stringify([old]) });
    const server = fakeServer();
    const first = createJournal({ storage, send: server.send });
    first.setUser('a', 'original');
    const id = first.log('app_session_start');
    await first.persist();

    const next = createJournal({ storage, send: server.send });
    next.setUser('a', 'other');
    next.setDeliveryUser('a');
    next.showFirstScreen();
    await jest.advanceTimersByTimeAsync(0);
    expect(server.send).not.toHaveBeenCalled();
    next.setUser('a', 'original');
    await jest.advanceTimersByTimeAsync(0);
    expect([...server.stored.keys()]).toEqual([id]);
  });

  it('при смене владельца во время RPC оставляет всю неудавшуюся пачку прежнему владельцу', async () => {
    let fail!: (error: Error) => void;
    const server = fakeServer();
    server.send.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const journal = createJournal({ storage: memoryStorage().storage, send: server.send });
    journal.setUser('a', 's1');
    journal.setDeliveryUser('a');
    journal.log('app_session_start');
    journal.log('screen_time');
    journal.showFirstScreen();
    await settle();
    journal.setUser('b', 'session-b');
    journal.setDeliveryUser('b');
    journal.log('app_session_start');
    fail(new Error('session changed'));
    await jest.advanceTimersByTimeAsync(1);
    expect(server.send.mock.calls.map(([batch]) => batch.map((e) => e.user_id))).toEqual([
      ['a', 'a'],
      ['b'],
    ]);
    expect(journal.queue.size('a')).toBe(2);
  });

  it('копит события и отправляет пачкой через несколько секунд', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
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
    });

    expect(journal.log('search_query', { data: { query: 'x' } })).toBeNull();
    expect(journal.queue.size()).toBe(0);
  });

  it('без сети копит, повторяет с паузой и отправляет всё без дублей, когда сеть вернулась', async () => {
    const server = fakeServer();
    const journal = createJournal({
      storage: memoryStorage().storage,
      send: server.send,
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
    await settle();
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
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
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
    const journal = createJournal({ storage: memoryStorage().storage, send });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
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
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
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
    const first = createJournal({ storage, send: offline.send });

    offline.setOffline(true);
    first.setUser('u1', 'session-u1');
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
    const second = createJournal({ storage, send: server.send });

    second.setUser('u1', 'session-u1');
    second.setDeliveryUser('u1');
    second.showFirstScreen();
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
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
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
    });

    journal.setUser('u1', 'session-u1');
    journal.setDeliveryUser('u1');
    journal.showFirstScreen();
    server.setOffline(true);
    journal.log('search_query', { data: { query: 'a' } });
    journal.setUser('u2', 'session-u2');
    journal.setDeliveryUser('u2');
    server.setOffline(false);
    journal.log('search_query', { data: { query: 'b' } });
    await jest.advanceTimersByTimeAsync(5000);

    expect([...server.stored.values()].map((event) => event.user_id)).toEqual(['u2']);
    expect(journal.queue.size('u1')).toBe(1);
  });
});
