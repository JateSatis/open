// Product limits, not schema invariants: the database only guarantees that a
// username is unique when set (see profiles_username_key). Length and alphabet
// are UX rules and may change, so they live on the client — CLAUDE.md § 2a.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 200;

const USERNAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Returns an error message to show under the field, or null when valid. */
export function validateUsername(value: string): string | null {
  const username = value.trim();

  if (username.length === 0) {
    return 'Придумайте имя пользователя';
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

/** What to show wherever a username is expected but may not be set yet. */
export function formatUsername(username: string | null): string | null {
  return username ? `@${username}` : null;
}

/** Fallback so a profile without display_name never renders as an empty line. */
export function displayNameOf(profile: {
  displayName: string | null;
  username: string | null;
}): string {
  return profile.displayName?.trim() || profile.username || 'Без имени';
}
