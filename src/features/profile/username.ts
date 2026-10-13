import type { UsernameKind } from '@/api/usernames';

// Product limits, not schema invariants: the database guarantees only that a
// username is unique within its kind and uses latin letters, digits and `_`
// (no dot anywhere). Length, lower case and the leading letter are UX rules
// shared by people, channels and groups and may change, so they live on the
// client — CLAUDE.md § 4.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 200;
/** Статус — одна строка под именем, как во ВКонтакте; в базе граница шире (200). */
export const STATUS_MAX_LENGTH = 70;
/** Сколько ждать после последней буквы, прежде чем спрашивать сервер о занятости имени. */
export const USERNAME_CHECK_DELAY_MS = 400;

/**
 * Суффикс вида на экране: `@max` — человек, `@max.ch` — канал, `@max.di` —
 * группа. В базе не хранится и не вводится: в поле он неизменяемая приставка.
 */
export const USERNAME_SUFFIX: Record<UsernameKind, string> = {
  profile: '',
  channel: '.ch',
  group: '.di',
};

const USERNAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Returns an error message to show under the field, or null when valid. Empty
 * is valid: a username is optional for people and groups, and the channel form
 * requires one by keeping «Создать» disabled until the name is free.
 */
export function validateUsername(value: string): string | null {
  const username = value.trim();

  if (username.length === 0) {
    return null;
  }

  if (username.includes('.')) {
    return 'Точка в имени недопустима';
  }

  if (username.length < USERNAME_MIN_LENGTH) {
    return `Минимум ${USERNAME_MIN_LENGTH} символа`;
  }

  if (username.length > USERNAME_MAX_LENGTH) {
    return `Максимум ${USERNAME_MAX_LENGTH} символов`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return 'Только латиница в нижнем регистре, цифры и _, начиная с буквы';
  }

  return null;
}

/**
 * Что пришло в поле — к тому, что хранится: без `@` спереди и без суффикса
 * своего вида в конце. Вставленное `@news.ch` в поле канала становится
 * `news`; чужой суффикс и любая другая точка остаются и дают ошибку.
 */
export function normalizeUsernameInput(value: string, kind: UsernameKind): string {
  const suffix = USERNAME_SUFFIX[kind];
  let username = value.replace(/^@+/, '');

  if (suffix && username.toLowerCase().endsWith(suffix)) {
    username = username.slice(0, -suffix.length);
  }

  return username;
}

/** `@имя` с суффиксом вида; без имени — null, и строки с `@` нет совсем. */
export function formatUsername(
  username: string | null,
  kind: UsernameKind = 'profile',
): string | null {
  return username ? `@${username}${USERNAME_SUFFIX[kind]}` : null;
}

/** Fallback so a profile without display_name never renders as an empty line. */
export function displayNameOf(profile: {
  displayName: string | null;
  username: string | null;
}): string {
  return profile.displayName?.trim() || profile.username || 'Без имени';
}
