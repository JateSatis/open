// Отдельно от `profile.ts`: ошибку проверяют экраны, а модуль запросов в
// тестах подменяется целиком.

/**
 * Профиля нет или он мне не виден: удалён, или его владелец меня
 * заблокировал. Различать нельзя — о блокировке не сообщается.
 */
export class ProfileUnavailableError extends Error {
  constructor() {
    super('Пользователь недоступен');
    this.name = 'ProfileUnavailableError';
  }
}
