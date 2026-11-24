// Подписанные ссылки на файлы закрытых бакетов Storage. В строках у файла —
// путь в бакете, а не адрес: показать его можно только по короткоживущей
// подписанной ссылке, и Storage выдаёт её лишь тому, кому файл открыт.
// Ссылки подписываются пачкой и живут в памяти, пока не подойдёт их срок.
// Кешировать сам файл надо по пути (`cacheKey`), а не по ссылке: у каждой
// подписи свой адрес.

import { perClient } from './perClient';
import { requestClient } from '@/api/requestClient';
import type { AccountClient } from '@/api/accountClient';

/** Больше путей в одном запросе Storage не подписывает за раз. */
const BATCH_LIMIT = 100;

/** Путь в бакете, а не адрес: у адреса есть схема (`https:`, `file:`, `data:`). */
export function isStoragePath(value: string | null | undefined): value is string {
  return !!value && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

export type SignedEntry = { url: string | null; expiresAt: number };

export type SignedUrlStore = {
  /** Попросить подписать путь, если ссылки нет или она скоро истечёт. */
  request: (path: string, api?: AccountClient) => void;
  /** Подписанная ссылка на путь, если она уже есть и ещё жива. */
  signed: (path: string) => string | null;
  /** Состояние подписи — новый объект после каждой подписи или отказа. */
  entry: (path: string, api?: AccountClient) => Readonly<SignedEntry> | undefined;
  /** Через сколько спросить снова: живую — чуть раньше срока, отказ — после паузы. */
  refreshDelay: (entry: Readonly<SignedEntry> | undefined) => number;
  subscribe: (listener: () => void, api?: AccountClient) => () => void;
  /** Забыть ссылки: файлы могли стать скрытыми от меня. */
  forget: () => void;
  /** Дождаться подписи пути: null — файл скрыт, его нет или нет сети. */
  sign: (path: string, api?: AccountClient) => Promise<string | null>;
};

export type SignedUrlOptions = {
  /** Сколько живёт подписанная ссылка. */
  ttlS: number;
  /** Переподписать заранее, чтобы ссылка не истекла посреди показа. */
  refreshBeforeMs: number;
  /** Отказ (файл скрыт или его нет) — спросить снова не раньше. */
  retryAfterMs: number;
};

export function createSignedUrlStore(bucket: string, options: SignedUrlOptions): SignedUrlStore {
  const forClient = perClient(api => createClientStore(bucket, options, api));
  const selected = () => forClient(requestClient());
  return {
    request: (path, api = requestClient()) => forClient(api).request(path),
    signed: path => selected().signed(path),
    entry: (path, api = requestClient()) => forClient(api).entry(path),
    refreshDelay: entry => selected().refreshDelay(entry),
    subscribe: (listener, api = requestClient()) => forClient(api).subscribe(listener),
    forget: () => selected().forget(),
    sign: (path, api = requestClient()) => forClient(api).sign(path),
  };
}

function createClientStore(bucket: string, options: SignedUrlOptions, api: AccountClient): SignedUrlStore {
  const { ttlS, refreshBeforeMs, retryAfterMs } = options;
  const entries = new Map<string, SignedEntry>();
  const listeners = new Set<() => void>();
  const waiters = new Map<string, ((url: string | null) => void)[]>();
  const queued = new Set<string>();
  const inFlight = new Set<string>();
  let flushScheduled = false;

  const notify = () => listeners.forEach((listener) => listener());

  const settle = (path: string) => {
    const waiting = waiters.get(path);

    if (!waiting) return;

    waiters.delete(path);
    waiting.forEach((resolve) => resolve(entries.get(path)?.url ?? null));
  };

  async function signBatch(paths: string[]): Promise<void> {
    const now = Date.now();

    try {
      const { data, error } = await api.storage.from(bucket).createSignedUrls(paths, ttlS);

      if (error || api.retired) throw error;

      const signed = new Map(
        (data ?? []).map((row) => [row.path, row.error ? null : row.signedUrl]),
      );

      for (const path of paths) {
        const url = signed.get(path) ?? null;

        entries.set(path, { url, expiresAt: url ? now + ttlS * 1000 : now + retryAfterMs });
      }
    } catch {
      // Сеть или Storage недоступны — заглушка, повтор чуть позже.
      for (const path of paths) {
        if (!entries.get(path)?.url) entries.set(path, { url: null, expiresAt: now + retryAfterMs });
      }
    } finally {
      paths.forEach((path) => {
        inFlight.delete(path);
        settle(path);
      });
      notify();
    }
  }

  function flush() {
    flushScheduled = false;

    const paths = [...queued];
    queued.clear();

    for (let at = 0; at < paths.length; at += BATCH_LIMIT) {
      void signBatch(paths.slice(at, at + BATCH_LIMIT));
    }
  }

  function stale(entry: SignedEntry | undefined, now: number): boolean {
    if (!entry) return true;

    return entry.url ? entry.expiresAt - now < refreshBeforeMs : entry.expiresAt <= now;
  }

  function request(path: string): void {
    if (inFlight.has(path) || queued.has(path) || !stale(entries.get(path), Date.now())) return;

    queued.add(path);
    inFlight.add(path);

    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flush, 0);
    }
  }

  function signed(path: string): string | null {
    const entry = entries.get(path);

    return entry?.url && entry.expiresAt > Date.now() ? entry.url : null;
  }

  return {
    request,
    signed,
    entry: (path) => entries.get(path),
    refreshDelay: (entry) => {
      if (!entry) return 0;

      const due = entry.url ? entry.expiresAt - refreshBeforeMs : entry.expiresAt;

      return Math.max(due - Date.now(), 0);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    forget: () => {
      entries.clear();
      notify();
    },
    sign: (path) => {
      if (api.retired) return Promise.resolve(null);
      const ready = signed(path);

      if (ready && !stale(entries.get(path), Date.now())) return Promise.resolve(ready);

      return new Promise((resolve) => {
        waiters.set(path, [...(waiters.get(path) ?? []), resolve]);
        request(path);

        // Подпись уже идёт или ещё не протухла после отказа — ответ тот, что есть.
        if (!inFlight.has(path)) settle(path);
      });
    },
  };
}
