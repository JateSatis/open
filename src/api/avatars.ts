// Фото людей лежат в закрытом бакете `avatars` (миграция
// `20261101140000_identity_avatars.sql`). В профиле и во всех выборках людей
// у аватара — путь в бакете, а не адрес: показать его можно только по
// короткоживущей подписанной ссылке (`signedUrls.ts`), и Storage выдаёт её
// лишь тому, кому владелец открыл фото. Внешний адрес (фото от Google) и фото
// групп и каналов показываются как есть.

import { createSignedUrlStore, isStoragePath, type SignedEntry } from '@/api/signedUrls';

export const AVATARS_BUCKET = 'avatars';

const store = createSignedUrlStore(AVATARS_BUCKET, {
  ttlS: 60 * 60,
  refreshBeforeMs: 5 * 60_000,
  retryAfterMs: 60_000,
});

export type AvatarEntry = SignedEntry;

/** Путь в бакете, а не адрес: у адреса есть схема (`https:`, `file:`, `data:`). */
export const isAvatarPath = isStoragePath;

/**
 * Попросить подписать путь, если ссылки нет или она скоро истечёт. Пути,
 * запрошенные в одном такте, уходят одним запросом.
 */
export const requestAvatarUrl = store.request;

/** Подписанная ссылка на путь, если она уже есть и ещё жива. */
export const signedAvatarUrl = store.signed;

/**
 * Состояние подписи пути — новый объект после каждой подписи или отказа, по
 * нему экран понимает, что пора перерисоваться.
 */
export const avatarEntry = store.entry;

/**
 * Через сколько спросить подпись снова: живую — чуть раньше её срока,
 * отказ — после паузы. 0 — уже пора.
 */
export const avatarRefreshDelay = store.refreshDelay;

export const subscribeAvatarUrls = store.subscribe;

/**
 * Забыть подписанные ссылки: человек сменил фото или его настройку, и
 * прежняя ссылка может вести к файлу, который мне больше не показывают.
 */
export const forgetAvatarUrls = store.forget;
