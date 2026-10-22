// Фото людей лежат в закрытом бакете `avatars` (миграция
// `20261101140000_identity_avatars.sql`). В профиле и во всех выборках людей
// у аватара — путь в бакете, а не адрес: показать его можно только по
// короткоживущей подписанной ссылке, и Storage выдаёт её лишь тому, кому
// владелец открыл фото. Ссылки подписываются пачкой и живут в памяти, пока не
// подойдёт их срок; внешний адрес (фото от Google) и фото групп и каналов
// показываются как есть.

import { supabase } from '@/api/supabase';

export const AVATARS_BUCKET = 'avatars';

/** Сколько живёт подписанная ссылка. */
const SIGNED_TTL_S = 60 * 60;
/** Переподписать заранее, чтобы ссылка не истекла посреди показа. */
const REFRESH_BEFORE_MS = 5 * 60_000;
/** Отказ (фото скрыто или файла нет) — спросить снова не раньше. */
const RETRY_AFTER_MS = 60_000;
/** Больше путей в одном запросе Storage не подписывает за раз. */
const BATCH_LIMIT = 100;

/** Путь в бакете, а не адрес: у адреса есть схема (`https:`, `file:`, `data:`). */
export function isAvatarPath(value: string | null | undefined): value is string {
  return !!value && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

type Entry = { url: string | null; expiresAt: number };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
const inFlight = new Set<string>();
let flushScheduled = false;

function notify() {
  listeners.forEach((listener) => listener());
}

async function signBatch(paths: string[]): Promise<void> {
  const now = Date.now();

  try {
    const { data, error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .createSignedUrls(paths, SIGNED_TTL_S);

    if (error) throw error;

    const signed = new Map((data ?? []).map((row) => [row.path, row.error ? null : row.signedUrl]));

    for (const path of paths) {
      const url = signed.get(path) ?? null;

      entries.set(path, {
        url,
        expiresAt: url ? now + SIGNED_TTL_S * 1000 : now + RETRY_AFTER_MS,
      });
    }
  } catch {
    // Сеть или Storage недоступны — заглушка, повтор чуть позже.
    for (const path of paths) {
      if (!entries.get(path)?.url) entries.set(path, { url: null, expiresAt: now + RETRY_AFTER_MS });
    }
  } finally {
    paths.forEach((path) => inFlight.delete(path));
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

function stale(entry: Entry | undefined, now: number): boolean {
  if (!entry) return true;

  return entry.url ? entry.expiresAt - now < REFRESH_BEFORE_MS : entry.expiresAt <= now;
}

/**
 * Попросить подписать путь, если ссылки нет или она скоро истечёт. Пути,
 * запрошенные в одном такте, уходят одним запросом.
 */
export function requestAvatarUrl(path: string): void {
  if (inFlight.has(path) || queued.has(path) || !stale(entries.get(path), Date.now())) return;

  queued.add(path);
  inFlight.add(path);

  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flush, 0);
  }
}

/** Подписанная ссылка на путь, если она уже есть и ещё жива. */
export function signedAvatarUrl(path: string): string | null {
  const entry = entries.get(path);

  return entry?.url && entry.expiresAt > Date.now() ? entry.url : null;
}

export function subscribeAvatarUrls(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Забыть подписанные ссылки: человек сменил фото или его настройку, и
 * прежняя ссылка может вести к файлу, который мне больше не показывают.
 */
export function forgetAvatarUrls(): void {
  entries.clear();
  notify();
}
